import type { Memoria } from "../../drizzle/schema";
import { expandirConsulta } from "./sinonimos";

/**
 * Escolha do que entra no contexto.
 *
 * O prompt de sistema já carrega persona e telemetria, e é reenviado a cada
 * rodada. Memória não pode entrar inteira: entra o que for relevante à pergunta,
 * dentro de um orçamento de caracteres.
 */

/* 3000 e não 1600: são 1,4 KB a mais num prompt que já carrega 14 KB só de
   esquema de ferramenta por rodada. O aperto não vinha daqui. */
export const ORCAMENTO_DE_CHARS = 3000;
export const MAX_ITENS = 12;
export const LIMIAR_DUPLICATA = 0.72;
/** Abaixo disto, a memória não tem relação com a pergunta. */
export const PISO_DE_RELEVANCIA = 0.12;

/** Palavras que aparecem em tudo e não ajudam a distinguir assunto. */
const VAZIAS = new Set([
  "a","o","as","os","um","uma","uns","umas","de","do","da","dos","das","em","no","na","nos","nas",
  "por","para","pra","com","sem","que","se","e","ou","mas","the","of","to","is","meu","minha",
  "seu","sua","ele","ela","eu","voce","isso","isto","aquilo","ao","aos","à","às","mais","muito",
]);

/**
 * Normaliza para comparação.
 *
 * A remoção de acento é essencial: ditado sem acento produziria uma memória
 * nova a cada conversa falada sobre o mesmo assunto.
 */
export function normalizarTexto(texto: string): string {
  return String(texto ?? "")
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Radical aproximado de uma palavra em português.
 *
 * Sem isto, "moro" e "mora" são palavras distintas para a comparação, e
 * perguntar "onde eu moro?" não acha a memória "o Senhor Edson mora em
 * Marília". Corta plural, terminação de infinitivo e vogal final — o suficiente
 * para as flexões regulares, que são a maioria.
 *
 * Não resolve verbo irregular ("prefiro" x "prefere") nem sinônimo ("cidade" x
 * o nome da cidade). Isso exigiria embeddings, que ficaram de fora de propósito:
 * o custo não se justifica para algumas centenas de memórias.
 */
export function radical(palavra: string): string {
  let base = palavra;
  if (base.length > 4 && base.endsWith("s")) base = base.slice(0, -1);
  if (base.length > 4 && /(ar|er|ir)$/.test(base)) base = base.slice(0, -2);
  while (base.length > 3 && /[aeo]$/.test(base)) base = base.slice(0, -1);
  return base;
}

export function tokenizar(texto: string): Set<string> {
  return new Set(
    normalizarTexto(texto)
      .split(" ")
      .filter((palavra) => palavra.length > 2 && !VAZIAS.has(palavra))
      .map(radical)
  );
}

/** Coeficiente de Dice sobre os tokens: barato, determinístico, sem rede. */
export function similaridade(a: string, b: string): number {
  const tokensA = tokenizar(a);
  const tokensB = tokenizar(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let comuns = 0;
  for (const token of tokensA) if (tokensB.has(token)) comuns += 1;

  return (2 * comuns) / (tokensA.size + tokensB.size);
}

/** Chave de identidade de um assunto: lembrar de novo atualiza, não acumula. */
export function chaveDoAssunto(conteudo: string): string {
  const tokens = [...tokenizar(conteudo)].sort();
  return tokens.slice(0, 6).join("-") || normalizarTexto(conteudo).slice(0, 40);
}

/**
 * Pontuação de uma memória para a pergunta atual.
 *
 * A relevância léxica é devolvida separada do total de propósito: o piso de
 * corte se aplica só a ela. Aplicado ao total, os bônus sozinhos passavam o
 * piso, e QUALQUER preferência entrava em toda pergunta — uma pergunta sobre
 * disco trazia a preferência de café.
 */
function pontuar(
  memoria: Memoria,
  consulta: string
): { relevancia: number; total: number } {
  const relevancia = similaridade(memoria.conteudo, consulta);

  const bonusTipo = memoria.tipo === "correcao" ? 0.35 : memoria.tipo === "preferencia" ? 0.1 : 0;
  const bonusUso = Math.min(0.15, (memoria.usos ?? 0) * 0.01);
  const bonusExplicita = memoria.origem === "explicita" ? 0.08 : 0;

  return { relevancia, total: relevancia + bonusTipo + bonusUso + bonusExplicita };
}

export type MemoriaSelecionada = { memoria: Memoria; pontuacao: number };

/**
 * Seleciona as memórias que entram no contexto desta pergunta.
 *
 * Fixadas entram sempre e primeiro. As demais disputam por pontuação, e o corte
 * respeita tanto o teto de itens quanto o de caracteres.
 */
export function selecionarMemorias(
  memorias: Memoria[],
  consulta: string,
  opcoes: { orcamento?: number; maxItens?: number } = {}
): MemoriaSelecionada[] {
  const orcamento = opcoes.orcamento ?? ORCAMENTO_DE_CHARS;
  const maxItens = opcoes.maxItens ?? MAX_ITENS;
  /*
   * A consulta é expandida com termos relacionados antes de comparar.
   *
   * Só o lado da CONSULTA: expandir também as memórias infla o denominador do
   * Dice e derruba todas as pontuações de uma vez.
   */
  const busca = expandirConsulta(consulta);
  const agora = Date.now();

  const vivas = memorias.filter((memoria) => {
    if (memoria.esquecida) return false;
    if (memoria.expiraEm && memoria.expiraEm.getTime() < agora) return false;
    return true;
  });

  const fixadas = vivas.filter((memoria) => memoria.fixada);
  const restantes = vivas
    .filter((memoria) => !memoria.fixada)
    .map((memoria) => {
      const { relevancia, total } = pontuar(memoria, busca);
      return { memoria, pontuacao: total, relevancia };
    })
    // Correção passa sem casar palavra: é o que o dono disse depois de o Jarvis
    // errar, e sumir por não casar lexicalmente é justamente o pior caso.
    .filter((item) => item.relevancia >= PISO_DE_RELEVANCIA || item.memoria.tipo === "correcao")
    .sort((a, b) => b.pontuacao - a.pontuacao);

  const escolhidas: MemoriaSelecionada[] = [];
  let usado = 0;

  for (const memoria of fixadas) {
    if (escolhidas.length >= maxItens) break;
    if (usado + memoria.conteudo.length > orcamento) break;
    escolhidas.push({ memoria, pontuacao: Infinity });
    usado += memoria.conteudo.length;
  }

  for (const item of restantes) {
    if (escolhidas.length >= maxItens) break;
    if (usado + item.memoria.conteudo.length > orcamento) continue;
    escolhidas.push(item);
    usado += item.memoria.conteudo.length;
  }

  return escolhidas;
}

/** Monta o bloco de texto. Lista vazia devolve string vazia, sem cabeçalho. */
export function montarBlocoDeMemoria(selecionadas: MemoriaSelecionada[]): string {
  if (selecionadas.length === 0) return "";
  return selecionadas
    .map((item) => `- ${item.memoria.conteudo}`)
    .join("\n");
}

/** Acha memória parecida o bastante para ser a mesma coisa dita de outro jeito. */
export function acharParecida(memorias: Memoria[], conteudo: string): Memoria | null {
  let melhor: Memoria | null = null;
  let melhorPontuacao = 0;

  for (const memoria of memorias) {
    if (memoria.esquecida) continue;
    const pontuacao = similaridade(memoria.conteudo, conteudo);
    if (pontuacao > melhorPontuacao) {
      melhorPontuacao = pontuacao;
      melhor = memoria;
    }
  }

  return melhorPontuacao >= LIMIAR_DUPLICATA ? melhor : null;
}
