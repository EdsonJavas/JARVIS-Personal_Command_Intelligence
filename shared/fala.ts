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

/**
 * Isto é um comando, não uma palavra?
 *
 * O dono ouviu "Get hífen ChildItem barra vertical Where hífen Object" e
 * disse o óbvio: isso não existe. Comando se DESCREVE em voz alta — "vou
 * listar os arquivos" — nunca se soletra. Um cmdlet, uma flag, um pipe, um
 * cifrão de variável, um `npm` ou `git` no começo: qualquer um denuncia.
 */
export function pareceComando(trecho: string): boolean {
  const t = trecho.trim();
  if (!t) return false;
  return (
    /\b[A-Z][a-z]+-[A-Z][A-Za-z]+\b/.test(t) || // Get-Process, Stop-Service
    /(^|\s)-{1,2}[A-Za-z]/.test(t) || // -Recurse, --force
    /[|$;{}]|&&|>>|\.\\|\$\(/.test(t) ||
    /^(npm|npx|git|cd|dir|del|copy|move|ren)\b/i.test(t)
  );
}

/** Um cmdlet com seus argumentos, até o fim da frase ou da linha. */
const CMDLET_COM_ARGUMENTOS = /\b[A-Z][a-z]+-[A-Z][A-Za-z]+\b[^.!?\n]*?(?=[.!?](\s|$)|\n|$)/g;

export function prepararFala(texto: string, limite = LIMITE_FALA): string {
  let saida = (texto ?? "").trim();
  if (!saida) return "";

  saida = saida
    // Blocos de código não se leem em voz alta.
    .replace(/```[\s\S]*?```/g, " ")
    // Trecho entre crases: um nome de arquivo se lê; um comando, não.
    .replace(/`([^`]+)`/g, (_, dentro: string) => (pareceComando(dentro) ? "o comando" : dentro))
    // Comando solto no texto, sem crase nenhuma — o modelo também faz isso.
    .replace(CMDLET_COM_ARGUMENTOS, "o comando")
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
