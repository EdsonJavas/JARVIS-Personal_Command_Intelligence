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

/** Um cmdlet, e onde ele começa. Os argumentos são varridos à parte. */
const CMDLET = /\b[A-Z][a-z]+-[A-Z][A-Za-z]+\b/g;

/**
 * Palavras que denunciam que a frase voltou a ser português.
 *
 * Sem elas, "Stop-Process -Name chrome -Force para encerrar" era engolido até
 * o ponto final, e a voz dizia "Usei o comando." — perdendo o "para encerrar"
 * que era justamente a informação útil. Ir até o fim da frase é fácil e
 * errado; parar na primeira conjunção acerta o caso real.
 */
const VOLTOU_AO_PORTUGUES =
  /^(para|pra|porque|por que|e|mas|entao|então|que|com|sem|no|na|em|de|do|da|ao|aos|à|as|os|assim|depois|antes|quando|se|ou|ai|aí|la|lá)$/i;

/**
 * Substitui cada cmdlet e seus argumentos por "o comando".
 *
 * Varredura manual em vez de `replace` global: com `replace`, um segundo
 * cmdlet dentro dos argumentos do primeiro — "Get-Process | Stop-Process" —
 * seria encontrado de novo e o texto viraria "o comando o comando".
 */
export function trocarComandos(texto: string): string {
  CMDLET.lastIndex = 0;
  let saida = "";
  let cursor = 0;
  let casou: RegExpExecArray | null;

  while ((casou = CMDLET.exec(texto)) !== null) {
    // Este cmdlet já foi engolido como argumento do anterior.
    if (casou.index < cursor) continue;

    const depois = /^[^.!?\n]*/.exec(texto.slice(casou.index + casou[0].length))?.[0] ?? "";

    // Consome os argumentos token a token, parando onde a prosa recomeça.
    let consumido = 0;
    for (const pedaco of depois.split(/(\s+)/)) {
      if (/^\s+$/.test(pedaco)) {
        consumido += pedaco.length;
        continue;
      }
      if (VOLTOU_AO_PORTUGUES.test(pedaco)) break;
      consumido += pedaco.length;
    }

    // O espaço final volta, para as palavras não colarem.
    const cauda = /\s*$/.exec(depois.slice(0, consumido))?.[0] ?? "";
    saida += texto.slice(cursor, casou.index) + "o comando" + cauda;
    cursor = casou.index + casou[0].length + consumido;
    CMDLET.lastIndex = cursor;
  }

  return saida + texto.slice(cursor);
}

export function prepararFala(texto: string, limite = LIMITE_FALA): string {
  let saida = (texto ?? "").trim();
  if (!saida) return "";

  saida = saida
    // Blocos de código não se leem em voz alta.
    .replace(/```[\s\S]*?```/g, " ")
    // Trecho entre crases: um nome de arquivo se lê; um comando, não.
    .replace(/`([^`]+)`/g, (_, dentro: string) => (pareceComando(dentro) ? "o comando" : dentro));

  /*
   * Comando solto no texto, SEM crase — o modelo também faz isso.
   *
   * Depois das crases e antes do resto da limpeza. Antes das crases, a
   * varredura engolia a crase de fechamento junto dos argumentos e
   * desbalanceava o par. Depois da limpeza inteira, o pipe já teria virado
   * espaço e o cmdlet perderia o que o identifica.
   */
  saida = trocarComandos(saida);

  saida = saida
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

/**
 * A resposta tem duas partes: a que é FALADA e a que é LIDA.
 *
 * O prompt pede ao modelo um parágrafo de abertura — curto, em prosa limpa —
 * seguido de linha em branco e do detalhe. A abertura vira voz; o resto fica
 * na tela.
 *
 * Por que linha em branco, e não um marcador inventado como `---VOZ---`:
 * porque degrada bem. Quando o modelo esquecer, o texto inteiro cai em
 * `prepararFala`, que já tira markdown e corta em 420 — ou seja, **o pior caso
 * é exatamente o comportamento de antes**. Um marcador esquecido apareceria
 * cru na tela.
 *
 * E por que não confiar só no corte de 420: ele dá um PREFIXO, não um resumo.
 * Com texto rico, os primeiros 420 caracteres podem ser um título e o começo
 * de uma tabela. O parágrafo de abertura é o que faz a voz ser resumo.
 */

/** Abaixo disto não é um parágrafo de abertura, é um título solto. */
const MINIMO_DE_ABERTURA = 15;

/** Começos que denunciam estrutura: quem abre assim não escreveu uma fala. */
const COMECO_ESTRUTURADO = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|\||```|\s*\|)/;

export function dividirResposta(texto: string): { fala: string; detalhe: string } {
  const inteiro = (texto ?? "").trim();
  if (!inteiro) return { fala: "", detalhe: "" };

  const fronteira = /\n[ \t]*\n/.exec(inteiro);
  if (!fronteira) return { fala: inteiro, detalhe: "" };

  const abertura = inteiro.slice(0, fronteira.index).trim();

  // Abertura estruturada ou curta demais: o modelo não seguiu o contrato.
  // Devolver o texto inteiro deixa `prepararFala` fazer o de sempre.
  if (!abertura || abertura.length < MINIMO_DE_ABERTURA || COMECO_ESTRUTURADO.test(abertura)) {
    return { fala: inteiro, detalhe: "" };
  }

  return {
    fala: abertura,
    detalhe: inteiro.slice(fronteira.index + fronteira[0].length).trim(),
  };
}

/** O que vai para a síntese: só a abertura, já higienizada e no teto. */
export function falaDaResposta(texto: string, limite = LIMITE_FALA): string {
  return prepararFala(dividirResposta(texto).fala, limite);
}
