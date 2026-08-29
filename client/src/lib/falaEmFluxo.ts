import { dividirResposta, prepararFala, separarFrases } from "@shared/fala";

export { separarFrases };

/**
 * Fala a resposta enquanto ela ainda está chegando.
 *
 * O texto vem em fluxo e aparece na tela palavra por palavra, mas a voz
 * esperava a ÚLTIMA palavra para começar. Numa resposta de cinco frases, o
 * dono lia tudo e só então ouvia a primeira. Aqui cada frase completa vai
 * para a fila assim que fecha, e a voz anda junto com o texto.
 *
 * Duas armadilhas, e é por elas que isto tem um módulo próprio:
 *
 * 1. O fluxo de uma rodada pode virar NARRAÇÃO, não resposta — o modelo fala
 *    "vou conferir o disco" e em seguida chama a ferramenta. O servidor manda
 *    esse texto de novo como `narracao`, e o final vem como `resposta`. Sem
 *    memória do que já saiu, cada frase seria dita duas vezes.
 *
 * 2. Fronteira de frase não é um ponto. "R$ 1.200,50", "Dr. Silva", "v3.2"
 *    têm pontos que não terminam nada. A regra aqui é conservadora: só corta
 *    em ponto seguido de espaço e de letra maiúscula, ou em fim de linha, e
 *    nunca em frase curta demais para ser uma frase.
 */

export type FalaEmFluxo = {
  /** Um pedaço do fluxo chegou. Devolve as frases que fecharam com ele. */
  receber: (pedaco: string) => string[];
  /**
   * O texto definitivo da rodada chegou — como narração ou como resposta.
   * Devolve só o que ainda não foi falado: o texto inteiro quando nada saiu
   * em fluxo, nada quando tudo já saiu, e o pedaço que faltava no meio-termo.
   */
  concluir: (textoFinal: string) => string[];
  /** Nova rodada do modelo: o que sobrou sem fechar não vale mais. */
  novaRodada: () => void;
};

function normalizar(texto: string): string {
  return prepararFala(texto, Number.MAX_SAFE_INTEGER).replace(/\s+/g, " ").trim();
}

export function criarFalaEmFluxo(): FalaEmFluxo {
  let rascunho = "";
  /*
   * A resposta tem duas partes, e só a primeira é falada. Assim que a linha
   * em branco chega pelo fluxo, o que vem depois é para a TELA — e continuar
   * emitindo faria a voz ler a tabela em voz alta.
   */
  let guiaFechado = false;
  const ditas: string[] = [];

  const registrar = (frases: string[]): string[] => {
    const faladas = frases.map((f) => prepararFala(f, Number.MAX_SAFE_INTEGER)).filter(Boolean);
    ditas.push(...faladas.map(normalizar));
    return faladas;
  };

  return {
    receber: (pedaco) => {
      if (guiaFechado) return [];
      rascunho += pedaco;

      const quebra = /\n[ \t]*\n/.exec(rascunho);
      if (quebra) {
        guiaFechado = true;
        // A quebra de linha no fim força a última frase do guia a fechar: a
        // fronteira dela é justamente a linha em branco.
        const guia = `${rascunho.slice(0, quebra.index)}\n`;
        rascunho = "";
        return registrar(separarFrases(guia).prontas);
      }

      const { prontas, resto } = separarFrases(rascunho);
      rascunho = resto;
      return registrar(prontas);
    },

    novaRodada: () => {
      rascunho = "";
      guiaFechado = false;
      ditas.length = 0;
    },

    concluir: (textoFinal) => {
      // Só a parte falada. O detalhe da tela nunca vira voz.
      const inteiro = normalizar(dividirResposta(textoFinal).fala);
      rascunho = "";
      guiaFechado = false;
      if (!inteiro) return [];

      // O que já foi dito é um prefixo do texto final, frase a frase. Anda
      // enquanto bater; o que sobra é o que falta falar.
      let posicao = 0;
      for (const dita of ditas) {
        const onde = inteiro.indexOf(dita, posicao);
        if (onde === -1 || onde > posicao + 2) break;
        posicao = onde + dita.length;
      }

      const restante = inteiro.slice(posicao).trim();
      ditas.length = 0;
      return restante ? [restante] : [];
    },
  };
}
