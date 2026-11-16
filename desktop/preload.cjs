/*
 * A ponte entre a página da ilha e o app de mesa.
 *
 * Expõe só o necessário, e nada de Node: a página continua sendo uma página.
 * O lado da página está em client/src/lib/desktop.ts.
 */

const { contextBridge, ipcRenderer } = require("electron");

function escutar(canal, fn) {
  const ouvinte = () => fn();
  ipcRenderer.on(canal, ouvinte);
  return () => ipcRenderer.removeListener(canal, ouvinte);
}

contextBridge.exposeInMainWorld("jarvisDesktop", {
  interativa: (sim) => ipcRenderer.send("ilha:interativa", Boolean(sim)),
  foco: (sim) => ipcRenderer.send("ilha:foco", Boolean(sim)),
  abrir: (alvo) => ipcRenderer.send("ilha:abrir", String(alvo)),
  aoAlternar: (fn) => escutar("ilha:alternar", fn),
  aoPerderFoco: (fn) => escutar("ilha:perdeu-foco", fn),
  aoMudarMesa: (fn) => {
    const ouvinte = (_evento, naMesa) => fn(Boolean(naMesa));
    ipcRenderer.on("ilha:mesa", ouvinte);
    // O aviso pode ter chegado antes de a página começar a ouvir: pergunta.
    void ipcRenderer.invoke("ilha:mesa-agora").then((naMesa) => fn(Boolean(naMesa)));
    return () => ipcRenderer.removeListener("ilha:mesa", ouvinte);
  },
});
