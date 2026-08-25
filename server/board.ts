/**
 * Área do painel escrita pelo Jarvis.
 *
 * É a diferença entre um painel que mostra o que alguém programou e um painel
 * que o assistente usa: ele pede uma busca, monta uma comparação, deixa um
 * lembrete — e aquilo aparece na outra janela. O dono pede por voz, o conteúdo
 * surge na tela.
 *
 * Vive em memória do servidor de propósito: é conteúdo de sessão, e as duas
 * janelas (núcleo e painel) falam com o mesmo processo, então ambas enxergam a
 * mesma coisa sem banco no meio.
 */

const MAX_CARTOES = 8;

export type TomDoCartao = "neutro" | "atencao" | "alerta" | "bom";

export type Cartao = {
  id: number;
  titulo: string;
  /** Linhas do cartão. Cada uma pode ser texto solto ou rótulo com valor. */
  itens: { rotulo?: string; texto: string }[];
  tom: TomDoCartao;
  nota: string | null;
  criadoEm: string;
};

let proximoId = 1;
let cartoes: Cartao[] = [];

export function listarCartoes(): Cartao[] {
  return cartoes;
}

export function adicionarCartao(entrada: {
  titulo: string;
  itens: { rotulo?: string; texto: string }[];
  tom?: TomDoCartao;
  nota?: string | null;
}): Cartao {
  const cartao: Cartao = {
    id: proximoId++,
    titulo: entrada.titulo.slice(0, 80),
    itens: entrada.itens.slice(0, 12).map((item) => ({
      rotulo: item.rotulo?.slice(0, 40),
      texto: item.texto.slice(0, 400),
    })),
    tom: entrada.tom ?? "neutro",
    nota: entrada.nota?.slice(0, 200) ?? null,
    criadoEm: new Date().toISOString(),
  };

  // O mais recente entra na frente; o excedente cai fora pelo fim.
  cartoes = [cartao, ...cartoes].slice(0, MAX_CARTOES);
  return cartao;
}

export function removerCartao(id: number): boolean {
  const antes = cartoes.length;
  cartoes = cartoes.filter((cartao) => cartao.id !== id);
  return cartoes.length !== antes;
}

export function limparCartoes(): number {
  const quantidade = cartoes.length;
  cartoes = [];
  return quantidade;
}

/** Resumo para o modelo saber o que já está na tela e não repetir. */
export function describeBoardForModel(): string {
  if (cartoes.length === 0) return "";
  return (
    "No painel, você já deixou: " +
    cartoes.map((cartao) => `"${cartao.titulo}" (${cartao.itens.length} linha(s))`).join("; ") +
    "."
  );
}
