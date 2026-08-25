import { exec } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(exec);

/**
 * O que dói no dia a dia de quem programa nesta máquina: repositórios com
 * trabalho não salvo, portas ocupadas e arquivos mexidos há pouco.
 *
 * A varredura de repositórios é a parte cara — percorre o disco — então roda
 * com profundidade limitada, em raízes conhecidas, e fica em cache longo. O
 * `git status` de cada repositório é barato e atualiza junto do painel.
 */

const REPOS_TTL_MS = 5 * 60 * 1000;
const PORTAS_TTL_MS = 60 * 1000;
const ARQUIVOS_TTL_MS = 2 * 60 * 1000;

export type Repositorio = {
  nome: string;
  caminho: string;
  ramo: string | null;
  alterados: number;
  naoRastreados: number;
  aFrente: number;
  atras: number;
  ultimoCommit: string | null;
  ultimoCommitEm: string | null;
};

export type Porta = { porta: number; processo: string | null };

export type ArquivoRecente = {
  nome: string;
  caminho: string;
  tamanhoBytes: number;
  modificadoEm: string;
};

export type VidaDeDev = {
  repositorios: Repositorio[];
  portas: Porta[];
  arquivos: ArquivoRecente[];
  medidoEm: string;
};

const VAZIO: VidaDeDev = { repositorios: [], portas: [], arquivos: [], medidoEm: "" };

async function powershell(script: string, timeoutMs = 45_000): Promise<string> {
  if (process.platform !== "win32") return "";
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const { stdout } = await run(
    `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`,
    { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }
  );
  return stdout.trim();
}

/* ----------------------------- repositórios ------------------------------ */

let caminhosCache: { at: number; value: string[] } | null = null;
let caminhosInFlight: Promise<string[]> | null = null;

/**
 * Localiza repositórios. As raízes vêm de DEV_ROOTS no .env (separadas por
 * ponto e vírgula) ou caem num conjunto razoável. A profundidade é limitada
 * porque varrer o disco inteiro levaria minutos e traria repositório de
 * dependência, não projeto.
 */
async function localizarRepositorios(): Promise<string[]> {
  const configuradas = process.env.DEV_ROOTS?.trim();
  const raizes = configuradas
    ? configuradas
        .split(";")
        .map((r) => r.trim())
        .filter(Boolean)
        .map((r) => `'${r.replace(/'/g, "''")}'`)
        .join(",")
    : `"$env:USERPROFILE","$env:USERPROFILE\\Documents","$env:USERPROFILE\\Desktop","$env:USERPROFILE\\Downloads"`;

  const saida = await powershell(`
$raizes = @(${raizes}) | Where-Object { Test-Path $_ }
$encontrados = @()
foreach ($r in $raizes) {
  $encontrados += Get-ChildItem -Path $r -Directory -Filter '.git' -Depth 3 -Force -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty FullName
}
$encontrados | Sort-Object -Unique | Select-Object -First 24 | ForEach-Object { Split-Path $_ -Parent }
`);

  return saida
    .split("\n")
    .map((linha) => linha.trim())
    .filter(Boolean)
    // node_modules e caches trazem repositórios que não são projeto do dono.
    .filter((caminho) => !/node_modules|\\\.cache|AppData/i.test(caminho));
}

/**
 * Devolve a PROMESSA dos caminhos. Quem lê o estado dos repositórios precisa
 * aguardá-la: ler um cache ainda vazio e gravar "nenhum repositório" prenderia
 * esse vazio pelo tempo de vida do cache seguinte.
 */
function caminhosDeRepositorio(): Promise<string[]> {
  const vencido = !caminhosCache || Date.now() - caminhosCache.at > REPOS_TTL_MS;
  if (!vencido && caminhosCache) return Promise.resolve(caminhosCache.value);
  if (caminhosInFlight) return caminhosInFlight;

  caminhosInFlight = localizarRepositorios()
    .then((value) => {
      caminhosCache = { at: Date.now(), value };
      return value;
    })
    .catch(() => caminhosCache?.value ?? [])
    .finally(() => {
      caminhosInFlight = null;
    });

  return caminhosInFlight;
}

/** Lê o estado de um repositório. `--porcelain=v2` é estável entre versões. */
async function lerRepositorio(caminho: string): Promise<Repositorio | null> {
  try {
    const [status, ultimo] = await Promise.all([
      run(`git -C "${caminho}" status --porcelain=v2 --branch`, { timeout: 12_000 }),
      /*
       * Separador %x1f, não "|": sem aspas, o cmd lê o pipe como pipe e o
       * comando morre. O `.catch` engolia o erro em silêncio, então TODO
       * repositório aparecia no painel como "sem commits" e sem data — parecia
       * dado ausente, era comando quebrado.
       */
      run(`git -C "${caminho}" log -1 --format="%s%x1f%cI"`, { timeout: 12_000 }).catch(() => ({
        stdout: "",
      })),
    ]);

    const linhas = status.stdout.split("\n");
    let ramo: string | null = null;
    let aFrente = 0;
    let atras = 0;
    let alterados = 0;
    let naoRastreados = 0;

    for (const linha of linhas) {
      if (linha.startsWith("# branch.head ")) {
        ramo = linha.slice("# branch.head ".length).trim();
      } else if (linha.startsWith("# branch.ab ")) {
        const partes = linha.slice("# branch.ab ".length).trim().split(" ");
        aFrente = Math.abs(Number(partes[0]) || 0);
        atras = Math.abs(Number(partes[1]) || 0);
      } else if (linha.startsWith("1 ") || linha.startsWith("2 ") || linha.startsWith("u ")) {
        alterados += 1;
      } else if (linha.startsWith("? ")) {
        naoRastreados += 1;
      }
    }

    const [assunto, quando] = (ultimo.stdout || "").trim().split("\x1f");

    return {
      nome: caminho.split(/[\\/]/).pop() ?? caminho,
      caminho,
      ramo,
      alterados,
      naoRastreados,
      aFrente,
      atras,
      ultimoCommit: assunto || null,
      ultimoCommitEm: quando || null,
    };
  } catch {
    return null;
  }
}

let reposCache: { at: number; value: Repositorio[] } | null = null;
let reposInFlight: Promise<Repositorio[]> | null = null;

function repositorios(): Repositorio[] {
  const vencido = !reposCache || Date.now() - reposCache.at > PORTAS_TTL_MS;
  if (vencido && !reposInFlight) {
    reposInFlight = (async () => {
      const caminhos = await caminhosDeRepositorio();
      const lidos = await Promise.all(caminhos.map(lerRepositorio));
      // Quem tem trabalho pendente sobe; entre iguais, o commit mais recente.
      return lidos
        .filter((r): r is Repositorio => r !== null)
        .sort((a, b) => {
          const pesoA = a.alterados + a.naoRastreados + a.aFrente;
          const pesoB = b.alterados + b.naoRastreados + b.aFrente;
          if (pesoA !== pesoB) return pesoB - pesoA;
          return (b.ultimoCommitEm ?? "").localeCompare(a.ultimoCommitEm ?? "");
        });
    })()
      .then((value) => {
        reposCache = { at: Date.now(), value };
        return value;
      })
      .catch(() => reposCache?.value ?? [])
      .finally(() => {
        reposInFlight = null;
      });
  }
  return reposCache?.value ?? [];
}

/* --------------------------------- portas --------------------------------- */

let portasCache: { at: number; value: Porta[] } | null = null;
let portasInFlight: Promise<Porta[]> | null = null;

function portas(): Porta[] {
  const vencido = !portasCache || Date.now() - portasCache.at > PORTAS_TTL_MS;
  if (vencido && !portasInFlight) {
    portasInFlight = powershell(
      `Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ` +
        `Where-Object { $_.LocalPort -lt 30000 } | Select-Object LocalPort,OwningProcess -Unique | ` +
        `Sort-Object LocalPort | Select-Object -First 16 | ForEach-Object { ` +
        `$p = (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName; "$($_.LocalPort)|$p" }`,
      20_000
    )
      .then((saida) =>
        saida
          .split("\n")
          .map((linha) => linha.trim())
          .filter(Boolean)
          .map((linha) => {
            const [porta, processo] = linha.split("|");
            return { porta: Number(porta), processo: processo || null };
          })
          .filter((p) => Number.isFinite(p.porta))
      )
      .then((value) => {
        portasCache = { at: Date.now(), value };
        return value;
      })
      .catch(() => portasCache?.value ?? [])
      .finally(() => {
        portasInFlight = null;
      });
  }
  return portasCache?.value ?? [];
}

/* ----------------------------- arquivos recentes -------------------------- */

let arquivosCache: { at: number; value: ArquivoRecente[] } | null = null;
let arquivosInFlight: Promise<ArquivoRecente[]> | null = null;

function arquivosRecentes(): ArquivoRecente[] {
  const vencido = !arquivosCache || Date.now() - arquivosCache.at > ARQUIVOS_TTL_MS;
  if (vencido && !arquivosInFlight) {
    arquivosInFlight = powershell(
      `Get-ChildItem -Path "$env:USERPROFILE\\Documents","$env:USERPROFILE\\Downloads","$env:USERPROFILE\\Desktop" ` +
        `-File -Recurse -Depth 2 -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | ` +
        `Select-Object -First 10 | ForEach-Object { "$($_.Name)|$($_.FullName)|$($_.Length)|$($_.LastWriteTime.ToString('o'))" }`,
      30_000
    )
      .then((saida) =>
        saida
          .split("\n")
          .map((linha) => linha.trim())
          .filter(Boolean)
          .map((linha) => {
            const [nome, caminho, tamanho, modificado] = linha.split("|");
            return {
              nome,
              caminho,
              tamanhoBytes: Number(tamanho) || 0,
              modificadoEm: modificado,
            };
          })
      )
      .then((value) => {
        arquivosCache = { at: Date.now(), value };
        return value;
      })
      .catch(() => arquivosCache?.value ?? [])
      .finally(() => {
        arquivosInFlight = null;
      });
  }
  return arquivosCache?.value ?? [];
}

/* -------------------------------- agregado -------------------------------- */

export function collectDevLife(): VidaDeDev {
  return {
    repositorios: repositorios(),
    portas: portas(),
    arquivos: arquivosRecentes(),
    medidoEm: new Date().toISOString(),
  };
}

/** Resumo em texto para o Jarvis falar sobre os projetos e a máquina de trabalho. */
export function describeDevLifeForModel(dev: VidaDeDev): string {
  if (dev.repositorios.length === 0 && dev.portas.length === 0) return "";

  const linhas: string[] = [];

  const pendentes = dev.repositorios.filter(
    (r) => r.alterados > 0 || r.naoRastreados > 0 || r.aFrente > 0
  );

  if (pendentes.length > 0) {
    linhas.push(
      "Repositórios com trabalho pendente: " +
        pendentes
          .slice(0, 6)
          .map(
            (r) =>
              `${r.nome} (ramo ${r.ramo ?? "?"}, ${r.alterados} alterado(s), ` +
              `${r.naoRastreados} novo(s)` +
              (r.aFrente > 0 ? `, ${r.aFrente} commit(s) sem enviar` : "") +
              ")"
          )
          .join("; ") +
        "."
    );
  } else if (dev.repositorios.length > 0) {
    linhas.push(`Os ${dev.repositorios.length} repositórios encontrados estão limpos.`);
  }

  if (dev.portas.length > 0) {
    linhas.push(
      "Portas em escuta: " +
        dev.portas
          .slice(0, 8)
          .map((p) => `${p.porta}${p.processo ? ` (${p.processo})` : ""}`)
          .join(", ") +
        "."
    );
  }

  return linhas.join("\n");
}
