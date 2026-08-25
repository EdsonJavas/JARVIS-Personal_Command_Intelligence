import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Rodízio de modelos quando a cota diária de um acaba.
 *
 * O plano gratuito do Gemini dá VINTE requisições por dia POR MODELO. Cada turno
 * do Jarvis gasta uma por rodada, então uma tarefa de três passos consome três —
 * na prática, umas sete conversas por dia antes de ele emudecer.
 *
 * A palavra que salva é "por modelo": a conta tem vários, cada um com sua
 * própria cota. Trocar de modelo ao esgotar transforma vinte em quase cem, sem
 * o dono precisar fazer nada e sem cartão de crédito.
 *
 * O que se paga por isso, dito claramente: os modelos não são iguais. O primeiro
 * da lista é o melhor, e os seguintes vão ficando mais simples. Um dia muito
 * longo termina com respostas menos afiadas — e isso é melhor que terminar em
 * silêncio.
 */

/*
 * A pasta de dados vem do ambiente.
 *
 * Sem isto, a suite de testes gravava no `data/` de verdade e uma execucao ao
 * vivo deixava um modelo marcado como esgotado — que o teste seguinte lia,
 * falhando por um motivo que nao tem nada a ver com o que ele verifica. Mesmo
 * vazamento que ja aconteceu com o banco.
 */
const PASTA_DADOS = process.env.JARVIS_DATA_DIR?.trim() || "data";
const ARQUIVO = resolve(process.cwd(), PASTA_DADOS, "modelos-esgotados.json");

/**
 * Ordem de preferência.
 *
 * Do mais capaz para o mais simples. `gemini-3.6-flash` primeiro porque é o que
 * o dono vinha usando e o que melhor decide quais ferramentas chamar.
 */
const PADRAO = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-flash-latest",
  "gemini-3.1-flash-lite",
  "gemini-flash-lite-latest",
];

type Registro = { dia: string; esgotados: string[] };

/** Dia local: a cota da Google vira à meia-noite do fuso do projeto. */
function hoje(): string {
  return new Date().toLocaleDateString("sv-SE");
}

function ler(): Registro {
  try {
    const dados = JSON.parse(readFileSync(ARQUIVO, "utf8")) as Registro;
    if (dados?.dia === hoje()) return dados;
  } catch {
    /* ainda não existe, ou é de ontem */
  }
  return { dia: hoje(), esgotados: [] };
}

function gravar(registro: Registro): void {
  try {
    mkdirSync(dirname(ARQUIVO), { recursive: true });
    writeFileSync(ARQUIVO, JSON.stringify(registro), "utf8");
  } catch {
    // Sem disco, a contagem vale só para este processo. Melhor que falhar.
  }
}

/** A lista configurada, ou a padrão. Vírgula separa. */
export function modelosDisponiveis(): string[] {
  const doAmbiente = process.env.LLM_MODELS?.trim();
  if (doAmbiente) {
    const lista = doAmbiente.split(",").map((m) => m.trim()).filter(Boolean);
    if (lista.length > 0) return lista;
  }

  // `LLM_MODEL` sozinho continua valendo: quem fixou um modelo não quer rodízio.
  const unico = process.env.LLM_MODEL?.trim();
  if (unico) return [unico, ...PADRAO.filter((m) => m !== unico)];

  return PADRAO;
}

/**
 * O modelo a usar agora.
 *
 * Quando TODOS estão esgotados, devolve o primeiro assim mesmo: é melhor tentar
 * e receber o 429 — que traz o tempo de espera — do que decidir aqui que não
 * vale tentar. A cota pode ter renovado no minuto anterior.
 */
export function modeloAtual(): string {
  const lista = modelosDisponiveis();
  const { esgotados } = ler();
  return lista.find((modelo) => !esgotados.includes(modelo)) ?? lista[0];
}

/** O próximo depois deste, ou nulo quando a fila acabou. */
export function proximoModelo(depoisDe: string): string | null {
  const lista = modelosDisponiveis();
  const { esgotados } = ler();

  const indice = lista.indexOf(depoisDe);
  const restantes = indice >= 0 ? lista.slice(indice + 1) : lista;

  return restantes.find((modelo) => !esgotados.includes(modelo)) ?? null;
}

export function marcarEsgotado(modelo: string): void {
  const registro = ler();
  if (registro.esgotados.includes(modelo)) return;

  registro.esgotados.push(modelo);
  gravar(registro);
  console.warn(
    `[Modelo] ${modelo} esgotou a cota do dia. ` +
      `Restam: ${modelosDisponiveis().filter((m) => !registro.esgotados.includes(m)).join(", ") || "nenhum"}.`
  );
}

/**
 * Um modelo riscado que respondeu está vivo: tira a marca.
 *
 * É a cura para marcação errada — a de ontem que sobrou, ou a de um 429 que o
 * provedor classificou mal. Sem isto, um erro de marcação dura até a virada.
 */
export function desmarcar(modelo: string): void {
  const registro = ler();
  if (!registro.esgotados.includes(modelo)) return;
  gravar({ dia: registro.dia, esgotados: registro.esgotados.filter((m) => m !== modelo) });
}

export function saldoDeModelos(): { total: number; livres: number; esgotados: string[] } {
  const lista = modelosDisponiveis();
  const { esgotados } = ler();
  return {
    total: lista.length,
    livres: lista.filter((modelo) => !esgotados.includes(modelo)).length,
    esgotados,
  };
}

/** Para o teste, e para quem quiser forçar nova tentativa antes da virada. */
export function limparEsgotados(): void {
  gravar({ dia: hoje(), esgotados: [] });
}
