<#
    O vigia da mesa: diz ao app da ilha se a área de trabalho está à vista.

    A ilha mora SÓ na área de trabalho. Qualquer janela aberta — não minimizada —
    em qualquer monitor a esconde; minimizou tudo, ela volta. O Electron não
    enxerga janela de outro programa, então quem olha é este processo, pela API
    do próprio Windows, e avisa por uma linha na saída quando o estado muda:

        mesa                      nada aberto: a ilha aparece
        janela<TAB>Título         algo aberto: a ilha some (e por causa de quem)

    Também recebe ordens pela entrada, uma por linha:

        focar <trecho do título>  traz para a frente uma janela que já existe
                                  (a Ponte), em vez de abrir outra igual

    Sai sozinho quando o app que o chamou (-Pai) termina.

        powershell -File desktop\vigia-da-mesa.ps1 -Pai <pid>
        powershell -File desktop\vigia-da-mesa.ps1 -Listar      só mostra quem conta
#>

param(
    [int] $Pai = 0,
    [switch] $Listar
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Console]::InputEncoding = [Text.Encoding]::UTF8

$fonte = @'
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class VigiaDaMesa {
    delegate bool EnumProc(IntPtr h, IntPtr l);

    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO {
        public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags;
    }

    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int idx);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(POINT p, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

    const int GWL_EXSTYLE = -20;
    const int WS_EX_TOOLWINDOW = 0x80;
    const int WS_EX_NOACTIVATE = 0x08000000;
    const int WS_EX_TRANSPARENT = 0x20;
    const int WS_EX_LAYERED = 0x80000;
    const uint GW_OWNER = 4;
    const int DWMWA_CLOAKED = 14;

    /*
     * Janelas do próprio Windows que estão sempre "abertas" e não são programa
     * do dono: a área de trabalho, a barra de tarefas, o Iniciar, os painéis
     * do sistema. Contá-las deixaria a ilha escondida para sempre.
     */
    static readonly HashSet<string> DoSistema = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
        "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd",
        "Windows.UI.Core.CoreWindow", "NotifyIconOverflowWindow", "TopLevelWindowForOverflowXamlIsland",
        "Shell_InputSwitchTopLevelWindow", "XamlExplorerHostIslandWindow", "MultitaskingViewFrame",
        "ForegroundStaging", "TaskListThumbnailWnd", "tooltips_class32", "#32768", "SysShadow",
        "Xaml_WindowedPopupClass", "PopupHost", "ApplicationManager_ImmersiveShellWindow",
        "EdgeUiInputTopWndClass", "Internet Explorer_Hidden", "IME", "MSCTFIME UI",
        "Shell_LightDismissOverlay", "LockScreenControllerProxyWindow"
    };

    [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);

    /*
     * TODOS os monitores, não só o da ilha. "Qualquer janela" quer dizer
     * qualquer uma: o WhatsApp aberto no segundo monitor também esconde a ilha.
     * Restringir a um monitor é trocar este retângulo pelo do monitor primário.
     */
    static RECT Monitor() {
        int x = GetSystemMetrics(76), y = GetSystemMetrics(77);
        return new RECT { Left = x, Top = y, Right = x + GetSystemMetrics(78), Bottom = y + GetSystemMetrics(79) };
    }

    static string Texto(IntPtr h) {
        var sb = new StringBuilder(512);
        GetWindowText(h, sb, sb.Capacity);
        return sb.ToString();
    }

    static string Classe(IntPtr h) {
        var sb = new StringBuilder(256);
        GetClassName(h, sb, sb.Capacity);
        return sb.ToString();
    }

    /// Esta janela é um programa aberto à vista, em algum monitor?
    static bool Conta(IntPtr h, uint pai, uint eu, RECT monitor) {
        if (!IsWindowVisible(h) || IsIconic(h)) return false;

        uint pid;
        GetWindowThreadProcessId(h, out pid);
        if (pid == pai || pid == eu) return false;

        if (GetWindow(h, GW_OWNER) != IntPtr.Zero) return false;

        int ex = GetWindowLong(h, GWL_EXSTYLE);
        if ((ex & WS_EX_TOOLWINDOW) != 0 || (ex & WS_EX_NOACTIVATE) != 0) return false;
        // Sobreposição que deixa o clique passar (contadores de FPS, gravadores):
        // não é janela que se "abre".
        if ((ex & WS_EX_TRANSPARENT) != 0 && (ex & WS_EX_LAYERED) != 0) return false;

        // Escondida pelo sistema sem estar minimizada: apps suspensos, outras
        // áreas de trabalho virtuais.
        int escondida;
        if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, out escondida, 4) == 0 && escondida != 0) return false;

        if (DoSistema.Contains(Classe(h))) return false;
        if (Texto(h).Length == 0) return false;

        RECT r;
        if (!GetWindowRect(h, out r)) return false;
        int largura = Math.Min(r.Right, monitor.Right) - Math.Max(r.Left, monitor.Left);
        int altura = Math.Min(r.Bottom, monitor.Bottom) - Math.Max(r.Top, monitor.Top);
        return largura >= 64 && altura >= 64;
    }

    static List<IntPtr> Abertas(uint pai, uint eu) {
        var monitor = Monitor();
        var lista = new List<IntPtr>();
        EnumWindows((h, l) => { if (Conta(h, pai, eu, monitor)) lista.Add(h); return true; }, IntPtr.Zero);
        return lista;
    }

    public static void ListarUmaVez(int pai) {
        SetProcessDPIAware();
        uint eu = (uint)Process.GetCurrentProcess().Id;
        var abertas = Abertas((uint)pai, eu);
        if (abertas.Count == 0) Console.WriteLine("nenhuma janela conta: a ilha apareceria");
        foreach (var h in abertas) {
            uint pid; GetWindowThreadProcessId(h, out pid);
            string nome = "";
            try { nome = Process.GetProcessById((int)pid).ProcessName; } catch { }
            Console.WriteLine(nome + " | " + Classe(h) + " | " + Texto(h));
        }
    }

    /// Traz para a frente a primeira janela cujo título contém o trecho.
    static bool Focar(string trecho, uint pai) {
        IntPtr achada = IntPtr.Zero;
        EnumWindows((h, l) => {
            if (!IsWindowVisible(h) && !IsIconic(h)) return true;
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (pid == pai || GetWindow(h, GW_OWNER) != IntPtr.Zero) return true;
            if (Texto(h).IndexOf(trecho, StringComparison.OrdinalIgnoreCase) < 0) return true;
            achada = h;
            return false;
        }, IntPtr.Zero);
        if (achada == IntPtr.Zero) return false;

        if (IsIconic(achada)) ShowWindow(achada, 9 /* SW_RESTORE */);
        // O Windows só deixa trazer janela para a frente quem recebeu a última
        // tecla. Um Alt sintético conta como essa tecla — é o jeito conhecido
        // de um processo em segundo plano obedecer a um atalho do dono.
        keybd_event(0x12, 0, 0, UIntPtr.Zero);
        keybd_event(0x12, 0, 2, UIntPtr.Zero);
        return SetForegroundWindow(achada);
    }

    public static void Rodar(int pai) {
        SetProcessDPIAware();
        Console.Out.Flush();
        uint eu = (uint)Process.GetCurrentProcess().Id;

        var ordens = new ConcurrentQueue<string>();
        var leitor = new Thread(() => {
            string linha;
            while ((linha = Console.In.ReadLine()) != null) ordens.Enqueue(linha);
        });
        leitor.IsBackground = true;
        leitor.Start();

        string anterior = null;
        int voltas = 0;
        while (true) {
            // Sem o app que nos chamou, não há ilha para esconder.
            if (pai != 0 && voltas % 8 == 0) {
                try { if (Process.GetProcessById(pai).HasExited) return; } catch { return; }
            }

            string ordem;
            while (ordens.TryDequeue(out ordem)) {
                if (ordem.StartsWith("focar ")) {
                    Console.WriteLine(Focar(ordem.Substring(6).Trim(), (uint)pai) ? "focou" : "nao-achou");
                    Console.Out.Flush();
                }
            }

            var abertas = Abertas((uint)pai, eu);
            string estado = abertas.Count == 0 ? "mesa" : "janela\t" + Texto(abertas[0]);
            if (estado != anterior) {
                Console.WriteLine(estado);
                Console.Out.Flush();
                anterior = estado;
            }

            voltas++;
            Thread.Sleep(250);
        }
    }
}
'@

Add-Type -TypeDefinition $fonte

if ($Listar) {
    [VigiaDaMesa]::ListarUmaVez($Pai)
} else {
    [VigiaDaMesa]::Rodar($Pai)
}
