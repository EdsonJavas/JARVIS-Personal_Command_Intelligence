/**
 * Leitura de uma recusa do provedor: o que ela SIGNIFICA, e não só o número.
 *
 * O defeito que isto corrige foi medido, não imaginado. O arquivo de rodízio
 * dizia que os cinco modelos estavam esgotados no dia; sondados um a um, três
 * responderam na hora. Só um estava esgotado de verdade.
 *
 * A causa: o Gemini devolve 429 para DUAS coisas diferentes — o teto do dia e
 * o teto do minuto — e o código tratava os dois como "acabou por hoje". Um
 * turno com três ferramentas dispara quatro pedidos em segundos, estoura o
 * minuto, e o modelo era riscado até a meia-noite. O dono clicava em reenviar,
 * o próximo modelo respondia, e parecia que tinha sido a cota. Depois de cinco
 * rajadas assim não sobrava modelo nenhum, e nem reenviar resolvia — enquanto
 * quatro deles estavam livres.
 *
 * O corpo do erro diz qual dos dois é. É ele que manda.
 */

export type Recusa =
  /** Teto do DIA deste modelo. Riscar até a virada. */
  | { tipo: "dia" }
  /** Teto do MINUTO, ou 429 sem dizer qual. Passa; não riscar. */
  | { tipo: "minuto"; esperaMs: number }
  /** 5xx: o provedor cambaleou. Outro modelo costuma responder. */
  | { tipo: "instavel" }
  /** Todo o resto: chave, modelo inexistente, pedido inválido. Não é cota. */
  | { tipo: "outra" };

/**
 * Quanto esperar quando o provedor não diz, ou diz demais.
 *
 * O `retryDelay` do Gemini veio de 14 s a 29 s nas medições. Acima do teto o
 * dono já desistiu — melhor devolver o erro, que ele reenvia quando quiser.
 */
const ESPERA_PADRAO_MS = 15_000;
const ESPERA_MAXIMA_MS = 30_000;

/** `"14s"`, `"14.5s"`, `"0.8s"` — o formato do campo `retryDelay`. */
function lerDuracao(texto: unknown): number | null {
  if (typeof texto !== "string") return null;
  const casou = /^(\d+(?:\.\d+)?)s$/.exec(texto.trim());
  return casou ? Math.round(Number(casou[1]) * 1000) : null;
}

/**
 * Percorre o JSON do erro sem assumir a forma exata.
 *
 * O Gemini manda `error.details[]`, e dentro deles `violations[].quotaId` e
 * `retryDelay`. O endpoint compatível às vezes embrulha tudo num array. Em vez
 * de codificar cada caminho, o que interessa é coletado de qualquer profundidade.
 */
function coletar(no: unknown, ids: string[], esperas: number[], fundo = 0): void {
  if (fundo > 8 || no === null || typeof no !== "object") return;

  if (Array.isArray(no)) {
    for (const item of no) coletar(item, ids, esperas, fundo + 1);
    return;
  }

  for (const [chave, valor] of Object.entries(no as Record<string, unknown>)) {
    if (chave === "quotaId" && typeof valor === "string") ids.push(valor);
    else if (chave === "retryDelay") {
      const ms = lerDuracao(valor);
      if (ms !== null) esperas.push(ms);
    } else coletar(valor, ids, esperas, fundo + 1);
  }
}

export function classificarRecusa(status: number, corpo: string): Recusa {
  if (status >= 500) return { tipo: "instavel" };
  if (status !== 429) return { tipo: "outra" };

  const ids: string[] = [];
  const esperas: number[] = [];
  try {
    coletar(JSON.parse(corpo), ids, esperas);
  } catch {
    // Corpo que não é JSON: tratado abaixo como 429 sem explicação.
  }

  // "PerDay" é o nome que a Google dá ao teto diário em todos os id's vistos:
  // `GenerateRequestsPerDayPerProjectPerModel-FreeTier`. O do minuto é
  // `...PerMinute...`. Quando os dois vêm juntos, o do dia é o que importa —
  // esperar um minuto não devolve a cota do dia.
  if (ids.some((id) => /PerDay/i.test(id))) return { tipo: "dia" };

  // Sem id nenhum, a escolha certa é a que erra para o lado recuperável: um
  // 429 mudo riscado como "dia" some por até 24 horas; tratado como "minuto",
  // custa no máximo uma espera curta.
  const esperaMs = Math.min(ESPERA_MAXIMA_MS, esperas[0] ?? ESPERA_PADRAO_MS);
  return { tipo: "minuto", esperaMs };
}
