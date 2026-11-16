<#
    Deixa a ilha do JARVIS permanente na área de trabalho: sobe com o Windows.

        npm run atalho:instalar     instala e abre a ilha agora
        npm run atalho:remover      tira do arranque e fecha a ilha

    Usa a pasta de Inicializar do usuário, e não o Agendador de Tarefas nem o
    registro: não precisa de administrador, é visível para quem quiser conferir
    (shell:startup), e sai com um arquivo apagado.

    O lançador é um atalho (.lnk) direto para o Electron do projeto. O Electron
    é programa de janela, não de console: nada pisca na tela no logon.

    Também desfaz a bandeja antiga em PowerShell, se ela estiver instalada: as
    duas disputariam o Ctrl+Alt+J e a segunda falharia.
#>

param([switch] $Remover)

$ErrorActionPreference = "Stop"

$raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$electron = Join-Path $raiz "node_modules\electron\dist\electron.exe"
$principal = Join-Path $raiz "desktop\main.cjs"
$inicializar = [Environment]::GetFolderPath("Startup")
$lancador = Join-Path $inicializar "JARVIS.lnk"
$lancadorAntigo = Join-Path $inicializar "JARVIS.vbs"

function Encerrar-Instancias {
    # Só as instâncias DESTE projeto: matar todo Electron ou PowerShell
    # derrubaria junto outros programas e qualquer terminal aberto.
    Get-CimInstance Win32_Process -Filter "Name = 'electron.exe' OR Name = 'powershell.exe'" |
        Where-Object {
            $_.ProcessId -ne $PID -and (
                $_.CommandLine -like "*desktop\main.cjs*" -or
                $_.CommandLine -like "*jarvis-bandeja.ps1*"
            )
        } |
        ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            Write-Output "  encerrei a instância anterior (pid $($_.ProcessId))"
        }
}

function Tirar-Lancadores {
    foreach ($arquivo in @($lancador, $lancadorAntigo)) {
        if (Test-Path $arquivo) {
            Remove-Item $arquivo -Force
            Write-Output "  removido: $arquivo"
        }
    }
}

if ($Remover) {
    Tirar-Lancadores
    Encerrar-Instancias
    Write-Output "Pronto. O JARVIS não sobe mais sozinho."
    exit 0
}

if (-not (Test-Path $electron)) {
    Write-Error "Não achei o Electron em $electron. Rode 'npm install' (e, se o npm bloquear scripts de instalação, 'node node_modules/electron/install.js')."
    exit 1
}

# Uma instância só: duas disputariam o mesmo atalho e a segunda falharia.
Encerrar-Instancias
Tirar-Lancadores

$shell = New-Object -ComObject WScript.Shell
$atalho = $shell.CreateShortcut($lancador)
$atalho.TargetPath = $electron
$atalho.Arguments = "`"$principal`""
$atalho.WorkingDirectory = $raiz
$atalho.IconLocation = (Join-Path $raiz "client\public\jarvis.ico")
$atalho.Description = "JARVIS — a ilha no alto da tela"
$atalho.Save()

Write-Output "Instalado em:"
Write-Output "  $lancador"
Write-Output ""

Start-Process -FilePath $electron -ArgumentList "`"$principal`"" -WorkingDirectory $raiz

# Espera POR CONDIÇÃO, não por tempo fixo: o Electron leva um instante na
# primeira vez, e um sleep curto daria aviso de falha com o processo subindo.
$viva = $null
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    $viva = Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" |
        Where-Object { $_.CommandLine -like "*desktop\main.cjs*" }
    if ($viva) { break }
}

if ($viva) {
    Write-Output "A ilha do JARVIS está no alto da área de trabalho."
    Write-Output "  só aparece com tudo minimizado (Win+D); qualquer janela aberta a esconde"
    Write-Output "  clique         abre o mini sistema: hoje, lembretes, memória"
    Write-Output "  Ctrl+Alt+J     na mesa abre e fecha; com janelas abertas, traz a Ponte"
    Write-Output "  Esc            fecha"
    Write-Output "  ícone ao lado do relógio: Ponte, painel, esconder, sair"
    Write-Output ""
    Write-Output "Sobe sozinha no próximo logon. Para desfazer: npm run atalho:remover"
} else {
    Write-Warning "O lançador foi criado, mas a ilha não subiu. Rode direto para ver o erro:"
    Write-Warning "  npm run ilha"
}
