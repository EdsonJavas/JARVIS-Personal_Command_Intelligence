<#
    JARVIS na bandeja, com atalho global.

    Isto é o que separa "um site que eu abro" de "um assistente do meu PC". Fica
    ao lado do relógio, sobe junto com o Windows, e responde a um atalho de
    qualquer aplicativo em que o Senhor Edson esteja.

    Sem dependência nova: usa a API do próprio Windows por P/Invoke. Nada de
    AutoHotkey para instalar, nada de Electron para empacotar — o projeto
    continua exatamente como está.

    Uso:
        powershell -ExecutionPolicy Bypass -File scripts\jarvis-bandeja.ps1

    Ou, para deixar permanente:
        npm run atalho:instalar
#>

param(
    [string] $Url = "http://localhost:3000",
    # Ctrl+Alt+J: mnemônico, e livre na maioria das instalações. Ctrl+Espaço
    # briga com o seletor de método de entrada em teclado com acentuação.
    [string] $Tecla = "J",
    [switch] $SemServidor
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$porta = ([Uri]$Url).Port

# ---------------------------------------------------------------- API do Windows

# Compilado uma vez, na subida. `RegisterHotKey` precisa de um handle de janela e
# de alguém escutando WM_HOTKEY: o filtro de mensagens é o jeito de fazer isso
# sem herdar de Form, o que o PowerShell não faz bem.
$fonte = @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class AtalhoGlobal : IMessageFilter, IDisposable {
    [DllImport("user32.dll")] private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
    [DllImport("user32.dll")] private static extern bool UnregisterHotKey(IntPtr hWnd, int id);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] private static extern IntPtr FindWindow(string cls, string win);

    private const int WM_HOTKEY = 0x0312;
    private const uint MOD_CONTROL = 0x0002;
    private const uint MOD_ALT = 0x0001;
    private const uint MOD_NOREPEAT = 0x4000;
    private const int SW_RESTORE = 9;

    private readonly Form _janelaOculta;
    private readonly int _id = 0xBEEF;
    public event Action Acionado;

    public AtalhoGlobal(char tecla) {
        // Janela invisível só para ter um handle: RegisterHotKey exige um, e não
        // há como registrar atalho global sem ele.
        _janelaOculta = new Form();
        _janelaOculta.ShowInTaskbar = false;
        _janelaOculta.WindowState = FormWindowState.Minimized;
        _janelaOculta.FormBorderStyle = FormBorderStyle.None;
        _janelaOculta.Load += (s, e) => { _janelaOculta.Size = new System.Drawing.Size(0, 0); _janelaOculta.Hide(); };
        _janelaOculta.CreateControl();
        var _ = _janelaOculta.Handle;

        // MOD_NOREPEAT: segurar o atalho não dispara dezenas de vezes.
        if (!RegisterHotKey(_janelaOculta.Handle, _id, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, (uint)tecla)) {
            throw new InvalidOperationException("Outro programa já usa este atalho.");
        }
        Application.AddMessageFilter(this);
    }

    public bool PreFilterMessage(ref Message m) {
        if (m.Msg == WM_HOTKEY && m.WParam.ToInt32() == _id) {
            if (Acionado != null) Acionado();
            return true;
        }
        return false;
    }

    /// Traz para frente uma janela que já existe, em vez de abrir outra.
    public static bool Focar(string titulo) {
        IntPtr h = FindWindow(null, titulo);
        if (h == IntPtr.Zero) return false;
        ShowWindow(h, SW_RESTORE);
        return SetForegroundWindow(h);
    }

    public void Dispose() {
        Application.RemoveMessageFilter(this);
        UnregisterHotKey(_janelaOculta.Handle, _id);
        _janelaOculta.Dispose();
    }
}
'@

Add-Type -TypeDefinition $fonte -ReferencedAssemblies System.Windows.Forms, System.Drawing

# ------------------------------------------------------------------- servidor

function Servidor-Responde {
    try {
        $c = New-Object Net.Sockets.TcpClient
        $c.Connect("127.0.0.1", $porta)
        $c.Close()
        return $true
    } catch { return $false }
}

function Subir-Servidor {
    if (Servidor-Responde) { return $true }

    # Sem servidor, a janela abriria numa página de erro — o que parece o Jarvis
    # quebrado, quando na verdade ele só não foi iniciado.
    Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c npm run dev" `
        -WorkingDirectory $raiz `
        -WindowStyle Hidden

    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        if (Servidor-Responde) { return $true }
    }
    return $false
}

# --------------------------------------------------------------------- janela

function Abrir-Jarvis {
    # Janela já aberta: traz para frente em vez de abrir outra. Sem isto, cada
    # atalho empilharia mais uma janela do Jarvis.
    if ([AtalhoGlobal]::Focar("JARVIS")) { return }

    if (-not $SemServidor -and -not (Servidor-Responde)) {
        $icone.ShowBalloonTip(3000, "JARVIS", "Iniciando o servidor…", "Info")
        if (-not (Subir-Servidor)) {
            $icone.ShowBalloonTip(5000, "JARVIS", "O servidor não subiu. Rode 'npm run dev' na pasta do projeto.", "Error")
            return
        }
    }

    # Modo aplicativo: janela sem barra de endereço nem abas, com cara de
    # programa. Chromium-only, então há queda para o navegador padrão.
    $candidatos = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
    )
    $navegador = $candidatos | Where-Object { Test-Path $_ } | Select-Object -First 1

    if ($navegador) {
        # Sem tamanho fixo: o Chrome restaura o estado maximizado da janela de app
        # por cima do --window-size, e a pagina ficava com o layout de 1280 ate
        # algo forcar recalculo — o conteudo aparecia cortado a direita.
        Start-Process $navegador -ArgumentList "--app=$Url", "--start-maximized"
    } else {
        Start-Process $Url
    }
}

# --------------------------------------------------------------------- bandeja

$icone = New-Object System.Windows.Forms.NotifyIcon
# A marca do JARVIS, em .ico com nove tamanhos: a bandeja pega o de 16 ou 20
# ja desenhado para aquele tamanho, em vez de encolher um grande e borrar.
$arquivoIcone = Join-Path $raiz "client\public\jarvis.ico"
$icone.Icon = if (Test-Path $arquivoIcone) {
    New-Object System.Drawing.Icon($arquivoIcone, 16, 16)
} else {
    [System.Drawing.SystemIcons]::Application
}
$icone.Text = "JARVIS — Ctrl+Alt+$Tecla"
$icone.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$itemAbrir = $menu.Items.Add("Abrir o JARVIS")
$itemAbrir.add_Click({ Abrir-Jarvis })

$itemPainel = $menu.Items.Add("Abrir o painel")
$itemPainel.add_Click({ Start-Process "$Url/dashboard" })

$menu.Items.Add("-") | Out-Null

$itemSair = $menu.Items.Add("Sair")
$itemSair.add_Click({
    $icone.Visible = $false
    [System.Windows.Forms.Application]::Exit()
})

$icone.ContextMenuStrip = $menu
$icone.add_DoubleClick({ Abrir-Jarvis })

# ----------------------------------------------------------------------- laço

try {
    $atalho = New-Object AtalhoGlobal ([char]$Tecla)
} catch {
    $icone.Visible = $false
    Write-Error "Não consegui registrar Ctrl+Alt+$Tecla. Outro programa já usa esse atalho. Use -Tecla para escolher outra."
    exit 1
}

$atalho.add_Acionado({ Abrir-Jarvis })

Write-Output "JARVIS na bandeja. Atalho: Ctrl+Alt+$Tecla. Botão direito no ícone para sair."
$icone.ShowBalloonTip(3000, "JARVIS", "Pronto. Ctrl+Alt+$Tecla chama a qualquer momento.", "Info")

try {
    [System.Windows.Forms.Application]::Run()
} finally {
    # Sem soltar o atalho, ele fica preso até o Windows reiniciar e a próxima
    # execução falharia dizendo que outro programa o usa — sendo esse programa
    # a execução anterior deste mesmo script.
    $atalho.Dispose()
    $icone.Dispose()
}
