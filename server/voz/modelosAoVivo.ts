import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Rodízio dos modelos de voz ao vivo — separado do rodízio de texto.
 *
 * A cota da Live é PRÓPRIA: nada do que acontece aqui diz respeito à cota de
 * `chat/completions`. Reaproveitar `jarvis/modelos.ts` faria uma falha de voz
 * riscar um modelo de texto perfeitamente saudável e calar o modo normal —
 * exatamente o defeito que já corrigimos uma vez, com outro nome.
 *
 * Os dois modelos foram testados contra a chave do dono: `setupComplete` em
 * 459 ms e 533 ms, aceitando ferramentas, pt-BR e transcrição. Ambos são
 * *preview*, e nome de preview some sem aviso — por isso a lista sai por
 * variável de ambiente e por isso a queda para o modo de texto é um caminho
 * testado, não um `catch` esquecido.
 */

const PADRAO = ["gemini-3.1-flash-live-preview", "gemini-2.5-flash-native-audio-latest"];

const PASTA = process.env.JARVIS_DATA_DIR?.trim() || "data";
const ARQUIVO = resolve(process.cwd(), PASTA, "voz-ao-vivo-esgotados.json");

type Registro = { dia: string; esgotados: string[] };

const hoje = () => new Date().toLocaleDateString("sv-SE");

function ler(): Registro {
  try {
    const lido = JSON.parse(readFileSync(ARQUIVO, "utf8")) as Registro;
    if (lido?.dia === hoje()) return lido;
  } catch {
    /* ainda não existe, ou é de ontem */
  }
  return { dia: hoje(), esgotados: [] };
}

function gravar(r: Registro): void {
  try {
    mkdirSync(dirname(ARQUIVO), { recursive: true });
    writeFileSync(ARQUIVO, JSON.stringify(r), "utf8");
  } catch {
    /* sem disco: vale para este processo */
  }
}

export function modelosAoVivo(): string[] {
  const doAmbiente = process.env.LIVE_MODELS?.trim();
  if (doAmbiente) {
    const lista = doAmbiente.split(",").map((m) => m.trim()).filter(Boolean);
    if (lista.length) return lista;
  }
  return PADRAO;
}

export function modeloAoVivoAtual(): string {
  const lista = modelosAoVivo();
  const { esgotados } = ler();
  return lista.find((m) => !esgotados.includes(m)) ?? lista[0];
}

export function proximoAoVivo(depoisDe: string): string | null {
  const lista = modelosAoVivo();
  const { esgotados } = ler();
  const i = lista.indexOf(depoisDe);
  const restantes = i >= 0 ? lista.slice(i + 1) : lista;
  return restantes.find((m) => !esgotados.includes(m)) ?? null;
}

export function marcarAoVivoEsgotado(modelo: string): void {
  const r = ler();
  if (r.esgotados.includes(modelo)) return;
  r.esgotados.push(modelo);
  gravar(r);
  console.warn(`[VozAoVivo] ${modelo} indisponível hoje.`);
}

/** Para o teste, e para quem quiser forçar nova tentativa. */
export function limparAoVivoEsgotados(): void {
  gravar({ dia: hoje(), esgotados: [] });
}
