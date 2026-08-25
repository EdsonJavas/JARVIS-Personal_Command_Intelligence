import { describe, expect, it } from "vitest";
import { ferramentasSemRisco } from "./registry";

/**
 * Toda ferramenta de escrita declara risco — ou é isenta por escrito.
 *
 * `ferramentasSemRisco()` existia com um comentário dizendo que servia para a
 * próxima ferramenta adicionada "falhar alto em vez de passar em branco pela
 * trava". Só que NADA a chamava: era código morto, e as onze ferramentas que
 * entraram depois passaram exatamente em branco.
 *
 * Este teste é o que faltava. Ele não julga se a decisão está certa — julga se
 * ela foi TOMADA: ou a ferramenta classifica o próprio risco, ou o nome dela
 * está na lista de isentas, com o motivo escrito ao lado.
 */
describe("cobertura da trava de risco", () => {
  it("nenhuma ferramenta escapa da decisão", () => {
    const escapando = ferramentasSemRisco();

    expect(
      escapando,
      `Estas ferramentas não declaram risco() nem constam em ISENTAS_DE_RISCO: ${escapando.join(", ")}. ` +
        "Ou classifique o risco, ou acrescente à lista de isentas explicando por quê."
    ).toEqual([]);
  });
});
