<#
    Deixa o JARVIS na bandeja permanente: sobe junto com o Windows.

        npm run atalho:instalar     instala e inicia agora
        npm run atalho:remover      tira do arranque e encerra

    Usa a pasta de Inicializar do usuário, e não o Agendador de Tarefas nem o
    registro: não precisa de administrador, é visível para quem quiser conferir
    (shell:startup), e sai com um arquivo apagado.

    O lançamento passa por um .vbs porque chamar o PowerShell direto pisca uma
    janela de console preta a cada logon — pequeno, mas é a diferença entre
    parecer um programa e parecer um script rodando às escondidas.
#>

param([switch] $Remover)

$ErrorActionPreference = "Stop"

$raiz = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$script = Join-Path $raiz "scripts\jarvis-bandeja.ps1"
$inicializar = [Environment]::GetFolderPath("Startup")
$lancador = Join-Path $inicializar "JARVIS.vbs"

function Encerrar-Bandeja {
    # Só as instâncias DESTE script: matar todo o PowerShell derrubaria junto o
    # servidor de desenvolvimento e qualquer terminal aberto.
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
        Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like "*jarvis-bandeja.ps1*" } |
        ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            Write-Output "  encerrei a instância anterior (pid $($_.ProcessId))"
        }
}

if ($Remover) {
    if (Test-Path $lancador) {
        Remove-Item $lancador -Force
        Write-Output "Removido do arranque do Windows."
    } else {
        Write-Output "Não estava no arranque."
    }
    Encerrar-Bandeja
    Write-Output "Pronto. O JARVIS não sobe mais sozinho."
    exit 0
}

if (-not (Test-Path $script)) {
    Write-Error "Não achei $script."
    exit 1
}

# Uma instância só: duas disputariam o mesmo atalho e a segunda falharia.
Encerrar-Bandeja

# Aspas DOBRADAS: é como o VBScript escapa aspas dentro de uma string. Escrevendo
# aspas simples, a primeira do caminho encerrava o literal e o arquivo virava
# VBScript inválido — o lançador era criado e não fazia nada, em silêncio.
$caminhoVbs = $script -replace '"', '""'

$vbs = @"
' Sobe o JARVIS na bandeja, sem piscar console.
' Criado por scripts\instalar-atalho.ps1 - apague este arquivo para desinstalar.
Dim aspas
aspas = Chr(34)
CreateObject("WScript.Shell").Run "powershell -NoProfile -ExecutionPolicy Bypass -File " & aspas & "$caminhoVbs" & aspas, 0, False
"@

# ASCII de propósito: o Windows Script Host lê .vbs na página de código do
# sistema, e um acento gravado em UTF-8 vira caractere inválido no arranque.
[IO.File]::WriteAllText($lancador, $vbs, [Text.Encoding]::ASCII)

Write-Output "Instalado em:"
Write-Output "  $lancador"
Write-Output ""

Start-Process "wscript.exe" -ArgumentList "`"$lancador`""

# Espera POR CONDIÇÃO, não por tempo fixo.
#
# A bandeja compila uma classe em C# no arranque, e isso leva alguns segundos na
# primeira vez. Um sleep de três segundos dava aviso de falha com o processo já
# subindo — o pior tipo de erro, o que faz desistir de algo que funcionou.
$viva = $null
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    $viva = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
        Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like "*jarvis-bandeja.ps1*" }
    if ($viva) { break }
}

if ($viva) {
    Write-Output "JARVIS está na bandeja, ao lado do relógio."
    Write-Output "  Ctrl+Alt+J    chama de qualquer lugar"
    Write-Output "  duplo clique  no ícone abre também"
    Write-Output "  botão direito no ícone para sair"
    Write-Output ""
    Write-Output "Sobe sozinho no próximo logon. Para desfazer: npm run atalho:remover"
} else {
    Write-Warning "O lançador foi criado, mas a bandeja não subiu. Rode direto para ver o erro:"
    Write-Warning "  powershell -ExecutionPolicy Bypass -File `"$script`""
}
