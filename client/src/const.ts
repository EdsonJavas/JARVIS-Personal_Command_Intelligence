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

/** Leva o navegador para a tela de senha. */
export const startLogin = () => {
  if (typeof window === "undefined") return;
  if (window.location.pathname === LOGIN_PATH) return;
  window.location.href = LOGIN_PATH;
};
