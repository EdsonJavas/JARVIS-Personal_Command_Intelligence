import { synthesizeSpeech } from "../jarvisTts";
import { prepararFala, separarFrases } from "@shared/fala";

/**
 * Sintetiza a resposta ENQUANTO ela é escrita, para o cliente achar tudo pronto.
 *
 * O maior gargalo medido do turno: a primeira frase de toda resposta pagava a
 * ida completa ao serviço de voz — 0,5 a 1,4 s de silêncio — porque a
 * pré-síntese do cliente (`filaDeFala`) só age sobre a PRÓXIMA frase, quando
 * uma já está tocando. Com a fila parada, a primeira nunca era antecipada.
 *
 * Mas o servidor tem o texto ANTES do cliente: ele o recebe do provedor e só
 * então o repassa por SSE, que atravessa React, fila e um POST de volta.
 * Sintetizar aqui, no instante em que a frase fecha, faz o `speak` do cliente
 * cair no cache — e o cache responde em milissegundos.
 *
 * Nada aqui é aguardado pelo turno. Falha, cota estourada ou lentidão não
 * atrasam nem derrubam a resposta: o cliente sintetiza normalmente, como antes.
 */

/** Frases longas demais não cabem numa síntese só; o cliente as divide. */
const MAX_CHARS = 400;

export type AquecedorDeFala = {
  /** Um pedaço do fluxo chegou. Sintetiza o que fechou. */
  receber: (pedaco: string) => void;
  /** Nova rodada: o rascunho anterior não vale mais. */
  novaRodada: () => void;
};

export function criarAquecedorDeFala(ligado = true): AquecedorDeFala {
  let rascunho = "";
  let guiaFechado = false;
  const jaPedidas = new Set<string>();

  const aquecer = (bruta: string) => {
    // A MESMA higienização que o cliente vai pedir: a chave do cache é o texto
    // final, então sintetizar o texto cru não aqueceria nada.
    const texto = prepararFala(bruta, MAX_CHARS).trim();
    if (!texto || texto.length > MAX_CHARS || jaPedidas.has(texto)) return;
    jaPedidas.add(texto);
    // Prioridade de anúncio: a reserva de cota da resposta fica intocada, e
    // este é um adiantamento oportunista, não o caminho obrigatório.
    void synthesizeSpeech(texto, { prioridade: "anuncio" }).catch(() => {
      /* sem voz agora: o cliente tenta de novo por conta dele */
    });
  };

  return {
    receber: (pedaco) => {
      if (!ligado || guiaFechado) return;
      rascunho += pedaco;

      // Depois da linha em branco é texto de tela, e texto de tela não é falado.
      const quebra = /\n[ \t]*\n/.exec(rascunho);
      if (quebra) {
        guiaFechado = true;
        for (const frase of separarFrases(`${rascunho.slice(0, quebra.index)}\n`).prontas) {
          aquecer(frase);
        }
        rascunho = "";
        return;
      }

      const { prontas, resto } = separarFrases(rascunho);
      rascunho = resto;
      for (const frase of prontas) aquecer(frase);
    },

    novaRodada: () => {
      rascunho = "";
      guiaFechado = false;
    },
  };
}
