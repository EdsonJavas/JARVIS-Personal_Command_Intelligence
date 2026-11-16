export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/** Rota da tela de senha. O login acontece inteiro dentro deste app. */
export const LOGIN_PATH = "/login";

/** Rota do painel de instrumentos, feita para abrir numa janela separada. */
export const BOARD_PATH = "/painel";

/**
 * Abre o painel numa janela própria, dimensionada para ocupar um monitor.
 * Reusa a janela pelo nome, então clicar de novo traz a existente para a frente
 * em vez de espalhar cópias pela área de trabalho.
 */
export const openBoardWindow = () => {
  if (typeof window === "undefined") return;
  const width = Math.min(1920, Math.round(window.screen.availWidth));
  const height = Math.min(1200, Math.round(window.screen.availHeight));
  window.open(
    BOARD_PATH,
    "jarvis-painel",
    `width=${width},height=${height},menubar=no,toolbar=no,location=no,status=no`
  )?.focus();
};

/**
 * Títulos das janelas. O app da ilha procura a Ponte já aberta PELO TÍTULO, para
 * trazê-la à frente em vez de abrir outra igual — mudar um destes é mudar
 * também `TITULO_DA_PONTE` em desktop/main.cjs.
 */
export const TITULOS = {
  ponte: "JARVIS · Ponte",
  painel: "JARVIS · Painel",
  ilha: "JARVIS · Ilha",
} as const;

/** Rota da ilha, carregada pelo app de mesa numa janela transparente. */
export const ILHA_PATH = "/ilha";

/** Evento disparado quando a sessão expira com a ilha aberta. */
export const SESSAO_EXPIROU_NA_ILHA = "jarvis:sessao-expirou";

/** Leva o navegador para a tela de senha. */
export const startLogin = () => {
  if (typeof window === "undefined") return;
  if (window.location.pathname === LOGIN_PATH) return;
  /*
   * Na ilha, não navega: a tela de login ocupa a janela inteira com fundo
   * escuro, e a janela da ilha é transparente e fica por cima de tudo. A ilha
   * pede a senha dentro dela mesma.
   */
  if (window.location.pathname.startsWith(ILHA_PATH)) {
    window.dispatchEvent(new Event(SESSAO_EXPIROU_NA_ILHA));
    return;
  }
  window.location.href = LOGIN_PATH;
};
