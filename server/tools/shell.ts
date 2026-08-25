import { exec } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(exec);

/**
 * Execução de comandos na máquina do dono.
 *
 * O alcance é deliberadamente amplo — foi a escolha explícita de quem roda este
 * servidor no próprio computador. O que este módulo garante não é restrição de
 * escopo, e sim que nenhuma execução trave o servidor, estoure a memória do
 * processo, sobreviva ao cancelamento ou aconteça sem deixar rastro.
 */

const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_OUTPUT_CHARS = 6_000;

/**
 * 512 KB, não 8 MB. O Node guarda a saída como UTF-16, então 8 MB de texto viram
 * 16 MB de string para render 6.000 caracteres — coleta de lixo no meio da
 * narração, numa máquina de 8 GB.
 */
const MAX_BUFFER_BYTES = 512 * 1024;

export type AuditEntry = {
  at: Date;
  tool: string;
  detail: string;
  ok: boolean;
  durationMs: number;
};

/**
 * O rastro de auditoria é o terminal onde o servidor roda: toda execução sai
 * ali, com ferramenta, duração e resumo. A interface mostra as ações junto da
 * resposta que as motivou.
 */
export function recordAudit(entry: AuditEntry) {
  console.info(
    `[Ação] ${entry.ok ? "ok" : "falha"} ${entry.tool} (${entry.durationMs}ms): ${entry.detail.slice(0, 160)}`
  );
}

/**
 * PIDs vivos de PowerShell disparados por aqui.
 *
 * O Windows não mata processos netos quando o pai morre, e não há job object no
 * caminho. Sem isto, cada reinício do `tsx watch` durante o desenvolvimento
 * deixa uma varredura recursiva de disco órfã girando — três salvamentos
 * durante uma tarefa longa deixam três varreduras concorrentes numa máquina de
 * 8 GB.
 */
const processosVivos = new Set<number>();

/**
 * Mata um PowerShell e tudo o que ele gerou.
 *
 * O `signal` do `exec` só alcança o filho direto: cancelar uma tarefa derrubava
 * o `powershell.exe` e deixava vivo o que ELE tinha disparado — um `robocopy`,
 * um `npm install`, uma varredura de disco. O dono cancelava e a máquina
 * continuava trabalhando.
 */
function matarArvore(pid: number): void {
  try {
    // /T alcança a árvore inteira; /F não pede licença.
    exec(`taskkill /PID ${pid} /T /F`, { windowsHide: true });
  } catch {
    /* já morreu */
  }
}

export function matarArvoreDeProcessos(): number {
  let mortos = 0;
  for (const pid of processosVivos) {
    matarArvore(pid);
    mortos += 1;
  }
  processosVivos.clear();
  return mortos;
}

/**
 * Remove blocos CLIXML da saída.
 *
 * O `$ProgressPreference` cobre o caso comum, mas o PowerShell serializa outras
 * coisas nesse formato quando roda sem console — aviso, registro de depuração.
 * Deixar passar faria XML aparecer como se fosse resposta do comando.
 */
function limparClixml(texto: string | undefined): string {
  if (!texto) return "";
  return texto
    .replace(/#<\s*CLIXML[\s\S]*?<\/Objs>/g, "")
    .replace(/#<\s*CLIXML[\s\S]*$/g, "")
    .trim();
}

function truncate(text: string): { texto: string; truncado: boolean } {
  const clean = (text ?? "").trim();
  if (clean.length <= MAX_OUTPUT_CHARS) return { texto: clean, truncado: false };
  return {
    texto: `${clean.slice(0, MAX_OUTPUT_CHARS)}\n… (saída truncada em ${MAX_OUTPUT_CHARS} caracteres)`,
    truncado: true,
  };
}

export type OpcoesShell = {
  timeoutMs?: number;
  sinal?: AbortSignal;
};

export type ShellResult = {
  ok: boolean;
  output: string;
  /** Verdadeiro quando a execução foi cortada por cancelamento, não por erro. */
  interrompido?: boolean;
};

/** Texto devolvido ao modelo quando o dono interrompe. */
export const TEXTO_INTERROMPIDO = "Execução interrompida pelo Senhor Edson.";

/**
 * Roda um comando PowerShell e devolve a saída combinada.
 *
 * O comando vai por `-EncodedCommand` em UTF-16LE base64: passá-lo como texto na
 * linha de comando obrigaria a escapar aspas, cifrões e crases, e qualquer falha
 * nesse escape viraria um comando diferente do pretendido.
 *
 * O segundo parâmetro é obrigatório de propósito. Ele existe para o compilador
 * apontar toda chamada que ainda não repassa o sinal de cancelamento — uma que
 * escape deixa aquele PowerShell rodando depois do cancelamento.
 */
export async function runPowerShell(
  command: string,
  opcoes: OpcoesShell
): Promise<ShellResult> {
  if (process.platform !== "win32") {
    return { ok: false, output: "Execução de comandos só está disponível no Windows." };
  }

  if (opcoes.sinal?.aborted) {
    return { ok: false, output: TEXTO_INTERROMPIDO, interrompido: true };
  }

  /*
   * `$ProgressPreference` silenciado antes de tudo.
   *
   * Sem isto o PowerShell escreve um registro de progresso em CLIXML no stderr
   * — "Preparando módulos para primeiro uso" — e ele era CONCATENADO à saída.
   * São cerca de 400 caracteres de XML grudados no fim de qualquer resultado, o
   * que contaminava toda ferramenta: um `Get-Clipboard` de 44 caracteres voltava
   * com 444, e o excedente parecia conteúdo.
   */
  /*
   * Saída em UTF-8, explicitamente.
   *
   * O PowerShell escreve na página de código do console — cp850 numa instalação
   * em português — e o Node decodifica como UTF-8. Sem acertar isto, TODO
   * resultado com acento voltava corrompido: "Relatório" virava "Relat?rio", e
   * o modelo recebia o texto quebrado como se fosse o conteúdo real.
   */
  const comSilencio = `$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
${command}`;
  const encoded = Buffer.from(comSilencio, "utf16le").toString("base64");
  const timeoutMs = opcoes.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const filho = run(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, {
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: MAX_BUFFER_BYTES,
    signal: opcoes.sinal,
  });

  const pid = filho.child.pid;
  if (pid !== undefined) processosVivos.add(pid);

  try {
    const { stdout, stderr } = await filho;
    const combinado = [limparClixml(stdout), limparClixml(stderr)]
      .filter((parte) => parte && parte.trim())
      .join("\n");
    const { texto } = truncate(combinado);
    return { ok: true, output: texto || "(sem saída)" };
  } catch (error) {
    const err = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
      killed?: boolean;
      name?: string;
      code?: string;
    };

    // Abort ANTES de killed: o AbortError chega com `killed` indefinido e cairia
    // no ramo genérico, entregando "The operation was aborted" em inglês como se
    // fosse resultado de ferramenta. O modelo então trataria como falha técnica
    // e tentaria outra rota — reexecutando o que o dono acabou de interromper.
    if (err.name === "AbortError" || opcoes.sinal?.aborted) {
      // O sinal derruba só o filho direto; os netos precisam do taskkill /T.
      if (pid !== undefined) matarArvore(pid);
      return { ok: false, output: TEXTO_INTERROMPIDO, interrompido: true };
    }

    if (err.killed) {
      // Idem no estouro de prazo: o comando lento é justamente o que costuma
      // ter disparado outro processo.
      if (pid !== undefined) matarArvore(pid);
      return {
        ok: false,
        output: `O comando passou de ${Math.round(timeoutMs / 1000)}s e foi abortado.`,
      };
    }

    // Estouro de buffer traz saída parcial: entregá-la sem marcar o corte faria
    // um número truncado passar por total.
    const parcial = [err.stdout, err.stderr, err.message]
      .filter((parte) => parte && String(parte).trim())
      .join("\n");
    const { texto, truncado } = truncate(parcial);
    const estourouBuffer = err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";

    return {
      ok: false,
      output:
        (texto || "Falha ao executar o comando.") +
        (estourouBuffer && !truncado ? "\n… (saída excedeu o limite e foi cortada)" : ""),
    };
  } finally {
    if (pid !== undefined) processosVivos.delete(pid);
  }
}
