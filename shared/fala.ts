/**
 * Preparo do texto que vai para a síntese de voz.
 *
 * A bolha da conversa recebe o texto íntegro; a voz recebe esta versão. Separar
 * os dois permite que a resposta escrita conserve o nome de um arquivo enquanto
 * a falada não soletra `C:\Users\es553\Documents\...`.
 */

export const LIMITE_FALA = 420;

/** Corta caminhos longos preservando o que interessa ouvir: o nome do arquivo. */
function encurtarCaminhos(texto: string): string {
  return texto.replace(/[A-Za-z]:\\[^\s"'`,;)]+/g, (caminho) => {
    const partes = caminho.split(/[\\/]/).filter(Boolean);
    return partes[partes.length - 1] ?? caminho;
  });
}

export function prepararFala(texto: string, limite = LIMITE_FALA): string {
  let saida = (texto ?? "").trim();
  if (!saida) return "";

  saida = saida
    // Blocos de código não se leem em voz alta.
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    // Ênfase e títulos do markdown.
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    // Marcadores de lista viram pausa, não símbolo lido.
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    // Endereços completos não se leem; o domínio basta.
    .replace(/https?:\/\/([^\s/]+)\S*/g, "$1")
    // Emojis e símbolos decorativos.
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
    .replace(/[|>]/g, " ");

  saida = encurtarCaminhos(saida);
  saida = saida.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();

  if (saida.length <= limite) return saida;

  // Corta em fronteira de frase. Cortar no meio de um número produz "treze
  // gigas e", que soa pior do que uma frase longa.
  const janela = saida.slice(0, limite);
  const ultimaPontuacao = Math.max(
    janela.lastIndexOf(". "),
    janela.lastIndexOf("! "),
    janela.lastIndexOf("? "),
    janela.lastIndexOf(".\n")
  );

  // Só corta se sobrar pelo menos metade do limite; caso contrário devolve a
  // frase inteira, mesmo passando do teto.
  if (ultimaPontuacao > limite * 0.5) return saida.slice(0, ultimaPontuacao + 1).trim();
  return saida;
}
