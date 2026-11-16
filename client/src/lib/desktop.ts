/**
 * A ponte entre a página da ilha e o app de mesa (desktop/main.cjs).
 *
 * A janela da ilha é maior do que a ilha: é um retângulo transparente, sempre
 * por cima, que deixa o clique passar. Quem sabe onde a ilha está desenhada é
 * a página, então é ela que avisa quando o mouse entra (para segurar o clique)
 * e quando precisa do teclado (para o dono escrever).
 *
 * Fora do app de mesa, num navegador comum, tudo aqui vira no-op: dá para abrir
 * /ilha numa aba e desenvolver o desenho sem o Electron.
 */

import { useEffect, useState } from "react";

export type AlvoDeAbertura = "ponte" | "painel";

type PonteNativa = {
  interativa: (sim: boolean) => void;
  foco: (sim: boolean) => void;
  abrir: (alvo: AlvoDeAbertura) => void;
  aoAlternar: (fn: () => void) => () => void;
  aoPerderFoco: (fn: () => void) => () => void;
  aoMudarMesa: (fn: (naMesa: boolean) => void) => () => void;
};

declare global {
  interface Window {
    jarvisDesktop?: PonteNativa;
  }
}

const nativa = (): PonteNativa | undefined =>
  typeof window === "undefined" ? undefined : window.jarvisDesktop;

/** Está rodando dentro do app de mesa? */
export const noDesktop = () => Boolean(nativa());

export const desktop = {
  /** O mouse está sobre a ilha: a janela passa a segurar o clique. */
  interativa(sim: boolean) {
    nativa()?.interativa(sim);
  },

  /**
   * Pede (ou devolve) o teclado. Fechada, a ilha nunca rouba o foco do que o
   * dono está fazendo; só aberta por ele.
   */
  foco(sim: boolean) {
    nativa()?.foco(sim);
  },

  abrir(alvo: AlvoDeAbertura) {
    const ponte = nativa();
    if (ponte) {
      ponte.abrir(alvo);
      return;
    }
    window.open(alvo === "painel" ? "/painel" : "/", `jarvis-${alvo}`)?.focus();
  },

  /** Ctrl+Alt+J, ou o clique no ícone da bandeja. */
  aoAlternar(fn: () => void): () => void {
    return nativa()?.aoAlternar(fn) ?? (() => {});
  },

  /** O dono clicou fora: a janela perdeu o foco. */
  aoPerderFoco(fn: () => void): () => void {
    return nativa()?.aoPerderFoco(fn) ?? (() => {});
  },

  /**
   * A área de trabalho ficou à vista (true) ou alguma janela abriu (false).
   * Quem decide é o vigia da mesa, no app de mesa.
   */
  aoMudarMesa(fn: (naMesa: boolean) => void): () => void {
    return nativa()?.aoMudarMesa(fn) ?? (() => {});
  },
};

/** A ilha está na área de trabalho à vista? Fora do app de mesa, sempre. */
export function useNaMesa(): boolean {
  const [naMesa, setNaMesa] = useState(true);
  useEffect(() => desktop.aoMudarMesa(setNaMesa), []);
  return naMesa;
}
