import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/**
 * Cache de fala sintetizada.
 *
 * A síntese neural leva de 2 a 7 segundos. Como as ferramentas anunciam o que
 * vão fazer com frases FIXAS — "Vou medir a máquina.", "Vou olhar seus
 * projetos." — pagar esse tempo toda vez é desperdício puro, e é o que fazia a
 * voz chegar sempre depois da execução: a ferramenta terminava em um segundo e o
 * áudio só aparecia três segundos mais tarde.
 *
 * Guardado em disco para sobreviver ao reinício do servidor: durante o
 * desenvolvimento o processo reinicia a cada salvamento, e um cache só em
 * memória nunca chegaria a esquentar.
 */

const PASTA = resolve(process.cwd(), "data", "voz");
/** Teto do cache em disco. Áudio de uma frase curta gira em torno de 100 KB. */
const MAX_BYTES = 64 * 1024 * 1024;
/** Espelho em memória: evita ida ao disco nas frases mais repetidas. */
const MAX_EM_MEMORIA = 64;

export type FalaSintetizada = {
  audio: string;
  mimeType: string;
  model: string;
  voice: string;
};

const emMemoria = new Map<string, FalaSintetizada>();

/**
 * A chave inclui modelo e voz: trocar a voz no `.env` tem que invalidar tudo,
 * senão o Jarvis passaria a falar com dois timbres diferentes na mesma frase.
 */
export function chaveDaFala(texto: string, model: string, voice: string): string {
  const normalizado = texto.trim().replace(/\s+/g, " ");
  return createHash("sha256").update(`${model}${voice}${normalizado}`).digest("hex");
}

function caminhoDe(chave: string): string {
  // Dois níveis de subpasta: um diretório com milhares de arquivos fica lento
  // de listar no Windows.
  return join(PASTA, chave.slice(0, 2), `${chave}.json`);
}

export async function lerDoCache(chave: string): Promise<FalaSintetizada | null> {
  const daMemoria = emMemoria.get(chave);
  if (daMemoria) return daMemoria;

  try {
    const bruto = await readFile(caminhoDe(chave), "utf8");
    const fala = JSON.parse(bruto) as FalaSintetizada;
    if (!fala?.audio) return null;
    guardarEmMemoria(chave, fala);
    return fala;
  } catch {
    // Ausente ou corrompido dá no mesmo: sintetiza de novo.
    return null;
  }
}

function guardarEmMemoria(chave: string, fala: FalaSintetizada): void {
  emMemoria.set(chave, fala);
  if (emMemoria.size > MAX_EM_MEMORIA) {
    // O mais antigo sai. `Map` preserva ordem de inserção.
    const maisAntigo = emMemoria.keys().next().value;
    if (maisAntigo) emMemoria.delete(maisAntigo);
  }
}

export async function gravarNoCache(chave: string, fala: FalaSintetizada): Promise<void> {
  guardarEmMemoria(chave, fala);
  try {
    const destino = caminhoDe(chave);
    await mkdir(dirname(destino), { recursive: true });
    await writeFile(destino, JSON.stringify(fala), "utf8");
  } catch {
    // Falha ao gravar não pode impedir a fala: o áudio já está em memória.
  }
}

/**
 * Apara o cache quando passa do teto, removendo os arquivos mais antigos.
 *
 * Roda em segundo plano e nunca lança: é limpeza, não caminho crítico.
 */
export async function aparar(): Promise<void> {
  try {
    const arquivos: { caminho: string; bytes: number; em: number }[] = [];

    for (const sub of await readdir(PASTA, { withFileTypes: true })) {
      if (!sub.isDirectory()) continue;
      const pastaSub = join(PASTA, sub.name);
      for (const nome of await readdir(pastaSub)) {
        const caminho = join(pastaSub, nome);
        const info = await stat(caminho);
        arquivos.push({ caminho, bytes: info.size, em: info.mtimeMs });
      }
    }

    let total = arquivos.reduce((soma, item) => soma + item.bytes, 0);
    if (total <= MAX_BYTES) return;

    arquivos.sort((a, b) => a.em - b.em);
    for (const arquivo of arquivos) {
      if (total <= MAX_BYTES) break;
      await unlink(arquivo.caminho).catch(() => {});
      total -= arquivo.bytes;
    }
  } catch {
    /* cache ainda não existe */
  }
}

/**
 * A frase já está pronta em cache?
 *
 * Precisa consultar a chave do caminho que SERÁ usado. Consultando sempre a do
 * provedor remoto, uma instalação com voz local nunca acharia nada e
 * ressintetizaria as mesmas frases a cada arranque, dizendo no log que o cache
 * estava vazio.
 */
export async function estaEmCache(texto: string): Promise<boolean> {
  const { assinaturaMicrosoft, vozMicrosoftLigada } = await import("./vozMicrosoft");

  // Na ordem do caminho real: Microsoft primeiro, que é quem responde hoje.
  if (vozMicrosoftLigada()) {
    const chave = chaveDaFala(texto, "microsoft", assinaturaMicrosoft());
    if ((await lerDoCache(chave)) !== null) return true;
  }

  const { assinaturaDaProsodia, vozLocalDisponivel, vozLocalPadrao } = await import("./vozLocal");

  if (vozLocalDisponivel()) {
    const vozId = vozLocalPadrao()?.id ?? "padrao";
    const chave = chaveDaFala(texto, `piper:${assinaturaDaProsodia()}`, vozId);
    return (await lerDoCache(chave)) !== null;
  }

  const model = process.env.TTS_MODEL?.trim() || "gemini-3.1-flash-tts-preview";
  const voice = process.env.TTS_VOICE?.trim() || "Charon";
  return (await lerDoCache(chaveDaFala(texto, model, voice))) !== null;
}
