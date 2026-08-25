/**
 * O que o Jarvis diz enquanto ainda não tem resposta.
 *
 * Silêncio depois de uma pergunta soa como não ter ouvido. O dono pediu o
 * contrário: se vai demorar, que avise que está pensando. As frases são
 * fixas de propósito — assim ficam em cache de voz desde o primeiro dia e
 * saem no mesmo instante, sem gastar cota nem esperar síntese.
 *
 * Compartilhado entre o cliente, que decide quando falar, e o servidor, que
 * as aquece de véspera.
 */

/**
 * Quanto silêncio antes do primeiro aviso.
 *
 * Curto demais, e ele diz "deixa eu ver" em cima de uma resposta que já
 * estava vindo — pior que o silêncio. Longo demais, e o dono já perguntou de
 * novo. Resposta curta chega em um a dois segundos; o aviso entra logo depois.
 */
export const PRIMEIRO_AVISO_MS = 1_800;

/** Depois do primeiro, um só lembrete: repetir vira ruído. */
export const SEGUNDO_AVISO_MS = 9_000;

export const PRIMEIROS_AVISOS = [
  "Deixa eu ver.",
  "Um instante, senhor.",
  "Só um momento.",
  "Estou verificando.",
] as const;

export const SEGUNDO_AVISO = "Ainda estou nisso, senhor. Já volto.";

export function frasesDeEspera(): string[] {
  return [...PRIMEIROS_AVISOS, SEGUNDO_AVISO];
}

/** Uma por vez, em rodízio: a mesma frase toda hora soa como gravação. */
export function proximoAviso(indice: number): string {
  return PRIMEIROS_AVISOS[indice % PRIMEIROS_AVISOS.length];
}
