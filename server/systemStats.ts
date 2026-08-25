import { exec } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";

const run = promisify(exec);

/**
 * Telemetria da máquina onde o servidor roda.
 *
 * A leitura é dividida em três velocidades:
 *
 *  · imediata — o que o módulo `os` entrega sem custo (CPU por núcleo, memória,
 *    tempo ligado) é recalculado a cada chamada;
 *  · periódica — contadores que exigem o Windows (discos, processos, E/S, GPU,
 *    rede) são lidos a cada poucos segundos, em segundo plano;
 *  · estática — modelo da máquina, BIOS, pentes de memória e placa de vídeo são
 *    lidos uma única vez por processo.
 *
 * Todas as consultas periódicas foram reunidas num ÚNICO processo do PowerShell.
 * Abrir um processo por métrica custava mais que o dado vale, e a soma dos
 * tempos de arranque dominava a leitura.
 *
 * As classes usadas são `Win32_PerfFormattedData_*` em vez de `Get-Counter`
 * de propósito: os nomes dos contadores do Get-Counter são traduzidos conforme
 * o idioma do Windows, e quebrariam nesta máquina em português.
 */

const LIVE_CACHE_MS = 5000;

export type DiskStat = {
  name: string;
  totalBytes: number;
  freeBytes: number;
  usedPercent: number;
};

export type ProcessStat = {
  name: string;
  memoryBytes: number;
  cpuSeconds: number;
};

export type NetworkStat = {
  name: string;
  address: string | null;
  rxPerSecond: number | null;
  txPerSecond: number | null;
  linkSpeedBps: number | null;
  status: string | null;
};

export type SystemStats = {
  host: {
    hostname: string;
    platform: string;
    release: string;
    arch: string;
    uptimeSeconds: number;
    osName: string | null;
    bootTime: string | null;
  };
  hardware: {
    manufacturer: string | null;
    model: string | null;
    biosVersion: string | null;
    biosDate: string | null;
    /** Um item por pente de memória instalado. */
    memoryModules: { capacityBytes: number; speedMhz: number | null }[];
  };
  cpu: {
    model: string;
    cores: number;
    speedMhz: number;
    usagePercent: number | null;
    perCore: (number | null)[];
    /** Fila do processador: acima de ~2 por núcleo indica gargalo real. */
    queueLength: number | null;
    threads: number | null;
    contextSwitchesPerSecond: number | null;
  };
  memory: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedPercent: number;
    committedBytes: number | null;
    cachedBytes: number | null;
    pagesPerSecond: number | null;
  };
  disks: DiskStat[];
  diskIo: {
    readPerSecond: number | null;
    writePerSecond: number | null;
    busyPercent: number | null;
    queueLength: number | null;
  };
  processes: ProcessStat[];
  processCount: number | null;
  gpu: {
    name: string | null;
    driverVersion: string | null;
    memoryBytes: number | null;
    /** Soma da utilização de todos os motores da GPU. */
    usagePercent: number | null;
  };
  battery: { percent: number; charging: boolean } | null;
  network: NetworkStat[];
  measuredAt: string;
};

/* ------------------------------ CPU (imediato) ------------------------------ */

type CpuSample = { idle: number; total: number };
let previousPerCore: CpuSample[] | null = null;

function sampleCores(): CpuSample[] {
  return os.cpus().map((cpu) => ({
    idle: cpu.times.idle,
    total:
      cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq,
  }));
}

function usageBetween(previous: CpuSample, current: CpuSample): number | null {
  const idleDelta = current.idle - previous.idle;
  const totalDelta = current.total - previous.total;
  if (totalDelta <= 0) return null;
  return Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));
}

/**
 * Uso de CPU é a razão entre tempo ocupado e tempo total decorrido entre duas
 * amostras. Uma amostra isolada não diz nada, então a primeira leitura devolve
 * null em vez de um número inventado. O agregado é derivado dos núcleos, para
 * que total e detalhe nunca discordem.
 */
function readCpuUsage(): { total: number | null; perCore: (number | null)[] } {
  const current = sampleCores();
  const previous = previousPerCore;
  previousPerCore = current;

  if (!previous || previous.length !== current.length) {
    return { total: null, perCore: current.map(() => null) };
  }

  const perCore = current.map((core, index) => usageBetween(previous[index], core));
  const measured = perCore.filter((value): value is number => value !== null);
  const total =
    measured.length > 0
      ? measured.reduce((sum, value) => sum + value, 0) / measured.length
      : null;

  return { total, perCore };
}

/* --------------------------------- Windows --------------------------------- */

async function powershell(script: string): Promise<string> {
  const { stdout } = await run(
    `powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`,
    { timeout: 25000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
  );
  return stdout.trim();
}

function num(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/* ------------------------- leitura estática (uma vez) ----------------------- */

type StaticInfo = {
  hardware: SystemStats["hardware"];
  gpu: { name: string | null; driverVersion: string | null; memoryBytes: number | null };
  osName: string | null;
  bootTime: string | null;
};

const EMPTY_STATIC: StaticInfo = {
  hardware: {
    manufacturer: null,
    model: null,
    biosVersion: null,
    biosDate: null,
    memoryModules: [],
  },
  gpu: { name: null, driverVersion: null, memoryBytes: null },
  osName: null,
  bootTime: null,
};

let staticCache: StaticInfo | null = null;
let staticInFlight: Promise<StaticInfo> | null = null;

const STATIC_SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue';",
  "$cs = Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model;",
  "$bios = Get-CimInstance Win32_BIOS | Select-Object SMBIOSBIOSVersion,ReleaseDate;",
  "$ram = @(Get-CimInstance Win32_PhysicalMemory | Select-Object Capacity,Speed);",
  "$vid = Get-CimInstance Win32_VideoController | Select-Object -First 1 Name,DriverVersion,AdapterRAM;",
  "$osi = Get-CimInstance Win32_OperatingSystem | Select-Object Caption,LastBootUpTime;",
  "@{ cs=$cs; bios=$bios; ram=$ram; vid=$vid; os=$osi } | ConvertTo-Json -Depth 4 -Compress",
].join(" ");

async function readStatic(): Promise<StaticInfo> {
  if (process.platform !== "win32") return EMPTY_STATIC;

  const raw = await powershell(STATIC_SCRIPT);
  if (!raw) return EMPTY_STATIC;

  const parsed = JSON.parse(raw);
  const bios = parsed.bios ?? {};
  const cs = parsed.cs ?? {};
  const vid = parsed.vid ?? {};
  const osi = parsed.os ?? {};

  return {
    hardware: {
      manufacturer: cs.Manufacturer ? String(cs.Manufacturer).trim() : null,
      model: cs.Model ? String(cs.Model).trim() : null,
      biosVersion: bios.SMBIOSBIOSVersion ? String(bios.SMBIOSBIOSVersion) : null,
      biosDate: bios.ReleaseDate ? String(bios.ReleaseDate) : null,
      memoryModules: asArray<Record<string, unknown>>(parsed.ram).map((module) => ({
        capacityBytes: num(module.Capacity) ?? 0,
        speedMhz: num(module.Speed),
      })),
    },
    gpu: {
      name: vid.Name ? String(vid.Name) : null,
      driverVersion: vid.DriverVersion ? String(vid.DriverVersion) : null,
      memoryBytes: num(vid.AdapterRAM),
    },
    osName: osi.Caption ? String(osi.Caption).trim() : null,
    bootTime: osi.LastBootUpTime ? String(osi.LastBootUpTime) : null,
  };
}

function getStatic(): StaticInfo {
  if (!staticCache && !staticInFlight) {
    staticInFlight = readStatic()
      .then((value) => {
        staticCache = value;
        return value;
      })
      .catch(() => EMPTY_STATIC)
      .finally(() => {
        staticInFlight = null;
      });
  }
  return staticCache ?? EMPTY_STATIC;
}

/* ------------------------ leitura periódica (uma chamada) ------------------- */

type LiveInfo = {
  disks: DiskStat[];
  processes: ProcessStat[];
  processCount: number | null;
  perf: {
    threads: number | null;
    queueLength: number | null;
    contextSwitchesPerSecond: number | null;
    committedBytes: number | null;
    cachedBytes: number | null;
    pagesPerSecond: number | null;
    diskReadPerSecond: number | null;
    diskWritePerSecond: number | null;
    diskBusyPercent: number | null;
    diskQueueLength: number | null;
    gpuUsagePercent: number | null;
  };
  battery: SystemStats["battery"];
  adapters: {
    /** Nome amigável, o mesmo que aparece nas conexões de rede do Windows. */
    friendlyName: string;
    linkSpeedBps: number | null;
    rxPerSecond: number | null;
    txPerSecond: number | null;
  }[];
};

const EMPTY_LIVE: LiveInfo = {
  disks: [],
  processes: [],
  processCount: null,
  perf: {
    threads: null,
    queueLength: null,
    contextSwitchesPerSecond: null,
    committedBytes: null,
    cachedBytes: null,
    pagesPerSecond: null,
    diskReadPerSecond: null,
    diskWritePerSecond: null,
    diskBusyPercent: null,
    diskQueueLength: null,
    gpuUsagePercent: null,
  },
  battery: null,
  adapters: [],
};

/**
 * Um único processo do PowerShell traz tudo. As classes de contador têm nomes
 * de propriedade em inglês mesmo num Windows traduzido, ao contrário dos nomes
 * de contador usados pelo Get-Counter.
 */
const LIVE_SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue';",
  "$d = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,Size,FreeSpace);",
  "$pr = Get-Process;",
  "$top = @($pr | Sort-Object WorkingSet64 -Descending | Select-Object -First 10 @{n='N';e={$_.Name}},@{n='M';e={$_.WorkingSet64}},@{n='C';e={$_.CPU}});",
  "$sys = Get-CimInstance Win32_PerfFormattedData_PerfOS_System | Select-Object Threads,ProcessorQueueLength,ContextSwitchesPerSec;",
  "$mem = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory | Select-Object CommittedBytes,CacheBytes,PagesPerSec;",
  "$dsk = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk | Where-Object { $_.Name -eq '_Total' } | Select-Object DiskReadBytesPerSec,DiskWriteBytesPerSec,PercentDiskTime,CurrentDiskQueueLength;",
  "$gpu = (Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | Measure-Object -Property UtilizationPercentage -Sum).Sum;",
  "$bat = Get-CimInstance Win32_Battery | Select-Object -First 1 EstimatedChargeRemaining,BatteryStatus;",
  // Get-NetAdapter e Get-NetAdapterStatistics carregam um módulo do PowerShell
  // e custavam 4s dos 14s da leitura inteira. Estas duas classes CIM entregam o
  // mesmo — e a de contador já traz a vazão calculada, dispensando a diferença
  // entre amostras que eu fazia à mão.
  "$nic = @(Get-CimInstance Win32_NetworkAdapter -Filter 'NetEnabled=true' | Select-Object Name,NetConnectionID,Speed);",
  "$np = @(Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface | Select-Object Name,BytesReceivedPersec,BytesSentPersec);",
  "@{ d=$d; top=$top; pc=$pr.Count; sys=$sys; mem=$mem; dsk=$dsk; gpu=$gpu; bat=$bat; nic=$nic; np=$np } | ConvertTo-Json -Depth 4 -Compress",
].join(" ");

let liveCache: { at: number; value: LiveInfo } | null = null;
let liveInFlight: Promise<LiveInfo> | null = null;

async function readLive(): Promise<LiveInfo> {
  if (process.platform !== "win32") return EMPTY_LIVE;

  const raw = await powershell(LIVE_SCRIPT);
  if (!raw) return EMPTY_LIVE;

  const parsed = JSON.parse(raw);
  const sys = parsed.sys ?? {};
  const mem = parsed.mem ?? {};
  const dsk = parsed.dsk ?? {};
  const bat = parsed.bat ?? null;

  const disks = asArray<Record<string, unknown>>(parsed.d)
    .filter((row) => (num(row.Size) ?? 0) > 0)
    .map((row) => {
      const totalBytes = num(row.Size) ?? 0;
      const freeBytes = num(row.FreeSpace) ?? 0;
      return {
        name: String(row.DeviceID),
        totalBytes,
        freeBytes,
        usedPercent: ((totalBytes - freeBytes) / totalBytes) * 100,
      };
    });

  const processes = asArray<Record<string, unknown>>(parsed.top).map((row) => ({
    name: String(row.N),
    memoryBytes: num(row.M) ?? 0,
    cpuSeconds: num(row.C) ?? 0,
  }));

  // A classe de contador identifica a placa pela descrição, com caracteres
  // sanitizados; a Win32_NetworkAdapter traz a descrição original e o nome
  // amigável. Normalizando os dois lados do mesmo jeito, o casamento é exato.
  const sanitize = (value: string) =>
    value
      .replace(/[\\/]/g, "_")
      .replace(/\(/g, "[")
      .replace(/\)/g, "]")
      .replace(/#/g, "_");

  const rates = new Map<string, { rx: number; tx: number }>();
  for (const row of asArray<Record<string, unknown>>(parsed.np)) {
    rates.set(sanitize(String(row.Name)), {
      rx: num(row.BytesReceivedPersec) ?? 0,
      tx: num(row.BytesSentPersec) ?? 0,
    });
  }

  const adapters = asArray<Record<string, unknown>>(parsed.nic).map((row) => {
    const rate = rates.get(sanitize(String(row.Name)));
    return {
      friendlyName: String(row.NetConnectionID ?? row.Name),
      linkSpeedBps: num(row.Speed),
      rxPerSecond: rate ? rate.rx : null,
      txPerSecond: rate ? rate.tx : null,
    };
  });

  return {
    disks,
    processes,
    processCount: num(parsed.pc),
    perf: {
      threads: num(sys.Threads),
      queueLength: num(sys.ProcessorQueueLength),
      contextSwitchesPerSecond: num(sys.ContextSwitchesPerSec),
      committedBytes: num(mem.CommittedBytes),
      cachedBytes: num(mem.CacheBytes),
      pagesPerSecond: num(mem.PagesPerSec),
      diskReadPerSecond: num(dsk.DiskReadBytesPerSec),
      diskWritePerSecond: num(dsk.DiskWriteBytesPerSec),
      diskBusyPercent: num(dsk.PercentDiskTime),
      diskQueueLength: num(dsk.CurrentDiskQueueLength),
      // A soma dos motores pode passar de 100 quando vários trabalham juntos.
      gpuUsagePercent: (() => {
        const value = num(parsed.gpu);
        return value === null ? null : Math.min(100, value);
      })(),
    },
    battery: bat
      ? (() => {
          const percent = num(bat.EstimatedChargeRemaining);
          if (percent === null) return null;
          // BatteryStatus 2 = ligado na tomada, conforme a tabela do WMI.
          return { percent, charging: num(bat.BatteryStatus) === 2 };
        })()
      : null,
    adapters,
  };
}

/** Devolve o cache na hora e atualiza em segundo plano. */
function getLive(): LiveInfo {
  const now = Date.now();
  const expired = !liveCache || now - liveCache.at > LIVE_CACHE_MS;

  if (expired && !liveInFlight) {
    liveInFlight = readLive()
      .then((value) => {
        liveCache = { at: Date.now(), value };
        return value;
      })
      .catch(() => liveCache?.value ?? EMPTY_LIVE)
      .finally(() => {
        liveInFlight = null;
      });
  }

  return liveCache?.value ?? EMPTY_LIVE;
}

/* -------------------------------- agregado -------------------------------- */

export function collectSystemStats(): SystemStats {
  const cpus = os.cpus();
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const live = getLive();
  const stat = getStatic();
  const cpuUsage = readCpuUsage();

  const addresses = new Map<string, string>();
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    const ipv4 = (list ?? []).find(
      (address) => address.family === "IPv4" && !address.internal
    );
    if (ipv4) addresses.set(name, ipv4.address);
  }

  // O filtro NetEnabled já exclui as dezenas de interfaces virtuais que o
  // Windows mantém e que não dizem nada.
  const network: NetworkStat[] = live.adapters
    .map((adapter) => ({
      name: adapter.friendlyName,
      address: addresses.get(adapter.friendlyName) ?? null,
      rxPerSecond: adapter.rxPerSecond,
      txPerSecond: adapter.txPerSecond,
      linkSpeedBps: adapter.linkSpeedBps,
      status: null,
    }))
    .slice(0, 3);

  return {
    host: {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      uptimeSeconds: Math.floor(os.uptime()),
      osName: stat.osName,
      bootTime: stat.bootTime,
    },
    hardware: stat.hardware,
    cpu: {
      model: cpus[0]?.model.trim() ?? "desconhecido",
      cores: cpus.length,
      speedMhz: cpus[0]?.speed ?? 0,
      usagePercent: cpuUsage.total,
      perCore: cpuUsage.perCore,
      queueLength: live.perf.queueLength,
      threads: live.perf.threads,
      contextSwitchesPerSecond: live.perf.contextSwitchesPerSecond,
    },
    memory: {
      totalBytes,
      freeBytes,
      usedBytes: totalBytes - freeBytes,
      usedPercent: ((totalBytes - freeBytes) / totalBytes) * 100,
      committedBytes: live.perf.committedBytes,
      cachedBytes: live.perf.cachedBytes,
      pagesPerSecond: live.perf.pagesPerSecond,
    },
    disks: live.disks,
    diskIo: {
      readPerSecond: live.perf.diskReadPerSecond,
      writePerSecond: live.perf.diskWritePerSecond,
      busyPercent: live.perf.diskBusyPercent === null ? null : Math.min(100, live.perf.diskBusyPercent),
      queueLength: live.perf.diskQueueLength,
    },
    processes: live.processes,
    processCount: live.processCount,
    gpu: {
      name: stat.gpu.name,
      driverVersion: stat.gpu.driverVersion,
      memoryBytes: stat.gpu.memoryBytes,
      usagePercent: live.perf.gpuUsagePercent,
    },
    battery: live.battery,
    network,
    measuredAt: new Date().toISOString(),
  };
}

/**
 * Resumo em texto para o modelo. Deixa o Jarvis responder "como está a máquina"
 * com números reais, em vez de inventar ou dizer que não tem acesso.
 */
export function describeSystemForModel(stats: SystemStats): string {
  const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);
  const mb = (bytes: number) => (bytes / 1024 ** 2).toFixed(1);
  const hours = Math.floor(stats.host.uptimeSeconds / 3600);
  const minutes = Math.floor((stats.host.uptimeSeconds % 3600) / 60);

  const lines = [
    `Máquina: ${stats.host.hostname}` +
      (stats.hardware.model ? ` (${stats.hardware.manufacturer ?? ""} ${stats.hardware.model})` : "") +
      `, ${stats.host.osName ?? stats.host.platform} ${stats.host.arch}.`,
    `Ligada há ${hours}h${String(minutes).padStart(2, "0")}.`,
    `CPU: ${stats.cpu.model}, ${stats.cpu.cores} núcleos` +
      (stats.cpu.usagePercent === null
        ? ", uso ainda não amostrado."
        : `, uso em ${stats.cpu.usagePercent.toFixed(0)}%.`),
    `Memória: ${gb(stats.memory.usedBytes)} GB em uso de ${gb(stats.memory.totalBytes)} GB (${stats.memory.usedPercent.toFixed(0)}%).`,
  ];

  if (stats.gpu.name) {
    lines.push(
      `Vídeo: ${stats.gpu.name}` +
        (stats.gpu.usagePercent !== null ? `, uso em ${stats.gpu.usagePercent.toFixed(0)}%.` : ".")
    );
  }

  if (stats.disks.length > 0) {
    lines.push(
      "Discos: " +
        stats.disks
          .map((disk) => `${disk.name} ${gb(disk.freeBytes)} GB livres de ${gb(disk.totalBytes)} GB`)
          .join("; ") +
        "."
    );
  }

  if (stats.diskIo.readPerSecond !== null) {
    lines.push(
      `E/S de disco: ${mb(stats.diskIo.readPerSecond)} MB/s de leitura e ${mb(stats.diskIo.writePerSecond ?? 0)} MB/s de escrita.`
    );
  }

  if (stats.processes.length > 0) {
    lines.push(
      `Processos ativos: ${stats.processCount ?? "?"}. Os que mais consomem memória: ` +
        stats.processes
          .slice(0, 5)
          .map((p) => `${p.name} (${gb(p.memoryBytes)} GB)`)
          .join(", ") +
        "."
    );
  }

  if (stats.network.length > 0) {
    lines.push(
      "Rede: " +
        stats.network
          .map(
            (net) =>
              `${net.name}${net.address ? ` em ${net.address}` : ""}` +
              (net.rxPerSecond !== null
                ? `, ${(net.rxPerSecond / 1024).toFixed(0)} KB/s de descida e ${((net.txPerSecond ?? 0) / 1024).toFixed(0)} KB/s de subida`
                : "")
          )
          .join("; ") +
        "."
    );
  }

  if (stats.battery) {
    lines.push(
      `Bateria: ${stats.battery.percent}%${stats.battery.charging ? " (carregando)" : ""}.`
    );
  }

  return lines.join("\n");
}
