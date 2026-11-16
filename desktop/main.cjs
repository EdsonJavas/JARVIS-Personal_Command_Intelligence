/*
 * JARVIS no PC: a ilha na área de trabalho, a bandeja e o atalho global.
 *
 *     npm run ilha
 *
 * A ilha mora SÓ na área de trabalho: uma pílula no alto da tela que aparece
 * quando nada está aberto e some assim que qualquer janela abre. Um clique abre
 * o mini sistema — o dia, os lembretes, a memória. Conversar é na Ponte.
 *
 * Quem sabe se há janela aberta é o vigia da mesa (vigia-da-mesa.ps1): o
 * Electron não enxerga janelas de outros programas.
 *
 * Por que Electron, e não o navegador: a ilha precisa de uma janela sem borda,
 * transparente e que deixe o clique passar onde não há ilha. Janela de
 * navegador não faz nada disso.
 *
 * A Ponte continua abrindo no navegador, em modo app: lá o reconhecimento de
 * voz do Chromium (ditado e "Jarvis" contínuo) funciona, e aqui não.
 */

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  session,
  shell,
} = require("electron");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const readline = require("node:readline");
const { spawn } = require("node:child_process");

const RAIZ = path.resolve(__dirname, "..");

/** A porta do servidor: a mesma do .env, como o servidor faz. */
function lerPorta() {
  if (process.env.JARVIS_PORTA) return Number(process.env.JARVIS_PORTA);
  try {
    const dotenv = require("dotenv");
    const env = dotenv.parse(fs.readFileSync(path.join(RAIZ, ".env")));
    if (env.PORT) return Number(env.PORT);
  } catch {
    /* sem .env: a porta padrão */
  }
  return 3000;
}

const PORTA = lerPorta();
const BASE = `http://localhost:${PORTA}`;
const ATALHO = "Control+Alt+J";

/** Mesmo texto de TITULOS.ponte em client/src/const.ts: é por ele que a Ponte é achada. */
const TITULO_DA_PONTE = "JARVIS · Ponte";

/*
 * A janela é maior que a ilha aberta: sobra margem para a sombra e para a mola
 * passar um pouco do tamanho final sem ser cortada pela borda da janela.
 */
const LARGURA = 720;
const ALTURA = 600;

/** Quanto a página leva para sumir com a ilha antes de a janela ser escondida. */
const SAIDA_MS = 200;

/** @type {BrowserWindow | null} */
let ilha = null;
/** @type {Tray | null} */
let bandeja = null;
/** O dono pediu, pela bandeja, para não ver a ilha. */
let ilhaEscondida = false;
/** A área de trabalho está à vista? Começa falso até o vigia dizer. */
let naMesa = false;
/** Por que a ilha está fora: o título da janela aberta. */
let motivo = "";
let saindo = false;

// ------------------------------------------------------------- uma instância

/*
 * Duas instâncias disputariam o atalho e empilhariam duas ilhas. A segunda só
 * cutuca a primeira, como se fosse o atalho, e sai.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => aoAtalho());
  app.whenReady().then(iniciar);
}

app.setAppUserModelId("JARVIS");

// Cookie da sessão, permissão do microfone e preferência de voz da ilha ficam
// aqui, com nome próprio, e não numa pasta genérica "Electron".
// JARVIS_DESKTOP_DADOS separa um teste do uso de verdade.
app.setPath(
  "userData",
  process.env.JARVIS_DESKTOP_DADOS || path.join(app.getPath("appData"), "JARVIS")
);

// Mora na bandeja: fechar todas as janelas não encerra o Jarvis.
app.on("window-all-closed", () => {});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  vigia?.kill();
});

// ------------------------------------------------------------------ servidor

function portaResponde() {
  return new Promise((resolver) => {
    const socket = net.connect({ port: PORTA, host: "127.0.0.1" });
    const fim = (ok) => {
      socket.destroy();
      resolver(ok);
    };
    socket.setTimeout(800);
    socket.once("connect", () => fim(true));
    socket.once("timeout", () => fim(false));
    socket.once("error", () => fim(false));
  });
}

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

let subindo = null;

/**
 * Garante o servidor de pé. Se não estiver, sobe o `npm run dev` escondido e
 * espera POR CONDIÇÃO — a porta responder — até trinta segundos.
 *
 * Desacoplado de propósito: fechar a ilha não derruba o servidor, que tem
 * lembretes e rotinas para disparar mesmo sem tela nenhuma aberta.
 */
function garantirServidor() {
  if (subindo) return subindo;
  subindo = (async () => {
    if (await portaResponde()) return true;
    const filho = spawn("cmd.exe", ["/c", "npm run dev"], {
      cwd: RAIZ,
      detached: true,
      windowsHide: true,
      stdio: "ignore",
    });
    filho.unref();
    for (let i = 0; i < 60; i += 1) {
      await esperar(500);
      if (await portaResponde()) return true;
    }
    return false;
  })().finally(() => {
    subindo = null;
  });
  return subindo;
}

// ---------------------------------------------------------- vigia da mesa

/** @type {import("node:child_process").ChildProcess | null} */
let vigia = null;
let falhasDoVigia = 0;
/** Respostas pendentes à ordem "focar", na ordem em que foram pedidas. */
const esperandoFoco = [];

/**
 * Sobe o vigia e reage ao que ele diz. Se ele cair, sobe de novo; se cair
 * sempre, a ilha passa a ficar sempre à vista — melhor que sumir para sempre
 * por causa do próprio vigia.
 */
function ligarVigia() {
  vigia = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(__dirname, "vigia-da-mesa.ps1"),
      "-Pai",
      String(process.pid),
    ],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
  );

  const linhas = readline.createInterface({ input: vigia.stdout });
  linhas.on("line", (linha) => {
    falhasDoVigia = 0;
    if (linha === "mesa") mudarMesa(true, "");
    else if (linha.startsWith("janela\t")) mudarMesa(false, linha.slice(7));
    else if (linha === "focou" || linha === "nao-achou") esperandoFoco.shift()?.(linha === "focou");
  });
  vigia.stderr.on("data", (dados) => console.error("[vigia]", String(dados).trim()));

  vigia.on("exit", () => {
    vigia = null;
    while (esperandoFoco.length) esperandoFoco.shift()?.(false);
    if (saindo) return;
    falhasDoVigia += 1;
    if (falhasDoVigia > 3) {
      console.error("[vigia] caiu demais; a ilha fica sempre à vista.");
      mudarMesa(true, "");
      return;
    }
    setTimeout(ligarVigia, 2_000);
  });
}

/** Pede ao vigia para trazer à frente uma janela pelo título. */
function focarJanela(trecho) {
  return new Promise((resolver) => {
    if (!vigia?.stdin?.writable) return resolver(false);
    const timer = setTimeout(() => {
      const i = esperandoFoco.indexOf(responder);
      if (i >= 0) esperandoFoco.splice(i, 1);
      resolver(false);
    }, 1_500);
    function responder(ok) {
      clearTimeout(timer);
      resolver(ok);
    }
    esperandoFoco.push(responder);
    vigia.stdin.write(`focar ${trecho}\n`);
  });
}

let saidaPendente = null;

function mudarMesa(agoraNaMesa, porque) {
  motivo = porque;
  atualizarDica();
  if (agoraNaMesa === naMesa) return;
  naMesa = agoraNaMesa;
  aplicarVisibilidade();
}

/**
 * Mostra ou esconde a janela da ilha conforme a mesa e a vontade do dono.
 *
 * Ao esconder, a página some com a ilha ANTES (ela recebe "ilha:mesa" e anima
 * a saída); a janela só é escondida depois. Ao mostrar, a janela aparece já
 * com a página avisada, e a ilha entra.
 */
function aplicarVisibilidade() {
  if (!ilha) return;
  const visivel = naMesa && !ilhaEscondida;
  clearTimeout(saidaPendente);
  ilha.webContents.send("ilha:mesa", visivel);

  if (visivel) {
    // O "mostrar área de trabalho" do Windows pode ter minimizado a ilha junto.
    if (ilha.isMinimized()) ilha.restore();
    if (!ilha.isVisible()) ilha.showInactive();
  } else {
    ilha.setIgnoreMouseEvents(true, { forward: true });
    saidaPendente = setTimeout(() => {
      if (ilha && !(naMesa && !ilhaEscondida)) ilha.hide();
    }, SAIDA_MS);
  }
}

// --------------------------------------------------------------------- ilha

function posicionar() {
  if (!ilha) return;
  const { workArea } = screen.getPrimaryDisplay();
  ilha.setBounds({
    x: Math.round(workArea.x + (workArea.width - LARGURA) / 2),
    y: workArea.y,
    width: LARGURA,
    height: ALTURA,
  });
}

function mostrarCarregando(estado) {
  if (!ilha) return;
  void ilha.loadFile(path.join(__dirname, "carregando.html"), { query: { estado } });
}

async function carregarIlha() {
  if (!ilha) return;
  mostrarCarregando("iniciando");
  const dePe = await garantirServidor();
  if (!ilha) return;
  if (!dePe) {
    mostrarCarregando("fora");
    avisar("O servidor não subiu. Rode 'npm run dev' na pasta do projeto.");
    setTimeout(carregarIlha, 15_000);
    return;
  }
  void ilha.loadURL(`${BASE}/ilha`);
}

function urlDaIlha(url) {
  return typeof url === "string" && url.startsWith(`${BASE}/ilha`);
}

function criarIlha() {
  ilha = new BrowserWindow({
    width: LARGURA,
    height: ALTURA,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    /*
     * NÃO fica sempre por cima. A ilha é da área de trabalho: qualquer janela
     * que abrir fica na frente dela no mesmo instante, antes até de o vigia
     * mandar escondê-la — nada pisca por cima do programa que o dono abriu.
     */
    alwaysOnTop: false,
    hasShadow: false,
    /*
     * Não recebe foco por padrão: um clique na pílula não pode tirar o cursor
     * do programa em que o dono está. A página pede o foco quando o dono abre
     * a ilha, e devolve quando fecha.
     */
    focusable: false,
    show: false,
    title: "JARVIS · Ilha",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      // Lembrete das 15h fala sozinho, sem clique antes. Sem isto o Chromium
      // bloqueia o áudio até o primeiro gesto do usuário na página.
      autoplayPolicy: "no-user-gesture-required",
      // A ilha passa a maior parte do dia escondida; sem isto os relógios da
      // página desaceleram e o lembrete falado atrasa.
      backgroundThrottling: false,
    },
  });

  ilha.setIgnoreMouseEvents(true, { forward: true });
  posicionar();

  // Primeira pintura: a página já sabe se está na mesa antes de aparecer.
  ilha.webContents.on("did-finish-load", () => aplicarVisibilidade());

  // Clique fora: a ilha volta a pílula e devolve o foco.
  ilha.on("blur", () => {
    ilha?.webContents.send("ilha:perdeu-foco");
    ilha?.setFocusable(false);
  });

  ilha.on("closed", () => {
    ilha = null;
  });

  const wc = ilha.webContents;

  // Recarregar a página (o Vite faz isso quando o servidor reinicia) zera o
  // estado do mouse: volta a deixar o clique passar até a ilha dizer o contrário.
  wc.on("did-start-navigation", (evento, ...posicionais) => {
    // O Electron novo põe os detalhes no próprio evento; o antigo, em argumentos.
    const principal = evento?.isMainFrame ?? posicionais[2];
    if (principal) ilha?.setIgnoreMouseEvents(true, { forward: true });
  });

  wc.on("did-fail-load", (_evento, codigo, _descricao, url, principal) => {
    // -3 é navegação abortada por outra navegação: não é falha.
    if (!principal || codigo === -3 || !url.startsWith(BASE)) return;
    mostrarCarregando("reconectando");
    setTimeout(carregarIlha, 2_000);
  });

  wc.on("render-process-gone", () => {
    if (!saindo) setTimeout(carregarIlha, 1_000);
  });

  // Link abre no navegador, nunca dentro da ilha.
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  wc.on("will-navigate", (evento, url) => {
    if (urlDaIlha(url) || url.startsWith("file:")) return;
    evento.preventDefault();
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
  });

  void carregarIlha();
}

/**
 * Ctrl+Alt+J, o clique na bandeja e uma segunda instância.
 *
 * Na área de trabalho, abre ou fecha o mini sistema. Com alguma janela aberta
 * a ilha não existe — o atalho leva à Ponte, trazendo a que já está aberta.
 */
function aoAtalho() {
  if (!ilha) {
    criarIlha();
    return;
  }
  if (naMesa && !ilhaEscondida) {
    ilha.webContents.send("ilha:alternar");
    return;
  }
  void abrirPonte("/");
}

function mostrarIlha(mostrar) {
  ilhaEscondida = !mostrar;
  aplicarVisibilidade();
  atualizarMenu();
}

// ------------------------------------------------------------- comunicação

/** Só a página da ilha fala com o app de mesa. */
function daIlha(evento) {
  return Boolean(ilha) && evento.sender === ilha.webContents && urlDaIlha(evento.senderFrame?.url);
}

ipcMain.on("ilha:interativa", (evento, sim) => {
  if (!daIlha(evento)) return;
  // Fora da mesa, a ilha nunca segura clique, diga a página o que disser.
  ilha.setIgnoreMouseEvents(!(sim && naMesa), { forward: true });
});

ipcMain.on("ilha:foco", (evento, sim) => {
  if (!daIlha(evento)) return;
  if (sim) {
    ilha.setFocusable(true);
    ilha.focus();
    ilha.webContents.focus();
  } else {
    ilha.setFocusable(false);
  }
});

ipcMain.handle("ilha:mesa-agora", (evento) => (daIlha(evento) ? naMesa && !ilhaEscondida : false));

ipcMain.on("ilha:abrir", (evento, alvo) => {
  if (!daIlha(evento)) return;
  if (alvo === "ponte") void abrirPonte("/");
  else if (alvo === "painel") abrirNoNavegador("/painel");
});

// -------------------------------------------------------------- navegador

/** A Ponte já aberta vem para a frente; só se não houver, abre outra. */
async function abrirPonte(caminho) {
  if (await focarJanela(TITULO_DA_PONTE)) return;
  abrirNoNavegador(caminho);
}

/**
 * A Ponte e o painel abrem no navegador, em modo app: janela sem barra de
 * endereço, com cara de programa. Lá o ditado e a escuta contínua funcionam.
 */
function abrirNoNavegador(caminho) {
  const url = `${BASE}${caminho}`;
  const candidatos = [
    path.join(process.env.ProgramFiles || "", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft/Edge/Application/msedge.exe"),
    path.join(process.env.ProgramFiles || "", "Microsoft/Edge/Application/msedge.exe"),
  ];
  const navegador = candidatos.find((caminhoDoExe) => fs.existsSync(caminhoDoExe));

  if (navegador) {
    const argumentos = [`--app=${url}`];
    if (caminho === "/") argumentos.push("--start-maximized");
    spawn(navegador, argumentos, { detached: true, stdio: "ignore" }).unref();
  } else {
    void shell.openExternal(url);
  }
}

// ------------------------------------------------------------------ bandeja

function avisar(texto) {
  bandeja?.displayBalloon({ title: "JARVIS", content: texto, iconType: "info" });
}

/** A dica do ícone diz por que a ilha não está à vista. */
function atualizarDica() {
  if (!bandeja) return;
  const porque = ilhaEscondida
    ? "ilha escondida pelo menu"
    : naMesa
      ? "ilha na área de trabalho"
      : `ilha fora: ${motivo}`.slice(0, 100);
  bandeja.setToolTip(`JARVIS — Ctrl+Alt+J\n${porque}`);
}

function atualizarMenu() {
  if (!bandeja) return;
  bandeja.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Abrir a Ponte", accelerator: ATALHO, click: () => void abrirPonte("/") },
      { label: "Abrir o painel", click: () => abrirNoNavegador("/painel") },
      { type: "separator" },
      {
        label: "Esconder a ilha",
        type: "checkbox",
        checked: ilhaEscondida,
        click: (item) => mostrarIlha(!item.checked),
      },
      { label: "Recarregar a ilha", click: () => void carregarIlha() },
      { type: "separator" },
      {
        label: "Sair",
        click: () => {
          saindo = true;
          app.quit();
        },
      },
    ])
  );
  atualizarDica();
}

function criarBandeja() {
  const arquivo = path.join(RAIZ, "client/public/jarvis.ico");
  const icone = fs.existsSync(arquivo) ? nativeImage.createFromPath(arquivo) : nativeImage.createEmpty();
  bandeja = new Tray(icone);
  bandeja.on("click", () => aoAtalho());
  atualizarMenu();
}

// -------------------------------------------------------------------- início

function iniciar() {
  /*
   * Microfone e notificação, só para o próprio servidor do Jarvis. Qualquer
   * outra origem que aparecesse aqui dentro fica sem.
   */
  const doJarvis = (origem) => typeof origem === "string" && origem.startsWith(BASE);
  session.defaultSession.setPermissionRequestHandler((wc, permissao, responder, detalhes) => {
    const origem = detalhes?.requestingUrl || wc.getURL();
    responder(doJarvis(origem) && (permissao === "media" || permissao === "notifications"));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permissao, origem) => {
    return doJarvis(origem) && (permissao === "media" || permissao === "notifications");
  });

  criarBandeja();
  criarIlha();
  // JARVIS_IGNORAR_JANELAS=1: a ilha fica sempre "na mesa". Para desenvolver
  // o desenho sem minimizar tudo, e de saída de emergência se o vigia errar.
  if (process.env.JARVIS_IGNORAR_JANELAS === "1") mudarMesa(true, "");
  else ligarVigia();

  if (!globalShortcut.register(ATALHO, aoAtalho)) {
    avisar(
      "Ctrl+Alt+J já está em uso por outro programa — talvez a bandeja antiga. " +
        "Rode 'npm run atalho:instalar' para trocar uma pela outra."
    );
  }

  for (const evento of ["display-added", "display-removed", "display-metrics-changed"]) {
    screen.on(evento, posicionar);
  }
}
