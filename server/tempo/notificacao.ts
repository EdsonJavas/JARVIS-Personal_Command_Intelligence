import { runPowerShell } from "../tools/shell";

/**
 * Notificação nativa do Windows.
 *
 * É o que faz a iniciativa valer quando o navegador está fechado — e essa é a
 * maior parte do dia. Sem isto, um lembrete marcado para as 15h simplesmente
 * não existiria se a aba não estivesse aberta, e o dono descobriria tarde que
 * confiou em algo que nunca ia tocar.
 */

/**
 * AppId de um programa que existe na máquina.
 *
 * O Windows recusa a notificação de um AppId desconhecido, e o do PowerShell é
 * o único garantido em qualquer instalação. O nome exibido é o dele, não
 * "Jarvis" — é o preço de não instalar um pacote só para isso.
 */
const APP_ID = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";

/** Escapa para XML: um "&" no texto do lembrete quebraria o documento inteiro. */
function paraXml(texto: string): string {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .slice(0, 300);
}

/** Escapa aspas simples para interpolar numa string do PowerShell. */
function psQuote(valor: string): string {
  return `'${String(valor).replace(/'/g, "''")}'`;
}

export async function notificarWindows(titulo: string, mensagem: string): Promise<boolean> {
  if (process.platform !== "win32") return false;

  const xml =
    `<toast><visual><binding template="ToastText02">` +
    `<text id="1">${paraXml(titulo)}</text>` +
    `<text id="2">${paraXml(mensagem)}</text>` +
    `</binding></visual></toast>`;

  const comando = [
    // O tipo só existe depois de carregado o WinRT; sem o Out-Null a linha
    // imprimiria a assembly na saída e poluiria o log.
    "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
    "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null",
    "$doc = New-Object Windows.Data.Xml.Dom.XmlDocument",
    `$doc.LoadXml(${psQuote(xml)})`,
    "$toast = New-Object Windows.UI.Notifications.ToastNotification $doc",
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(${psQuote(APP_ID)}).Show($toast)`,
  ].join("; ");

  const resultado = await runPowerShell(comando, {
    timeoutMs: 8_000,
    // Notificação não é cancelável junto com uma execução: ela é o aviso de que
    // algo venceu, e some sozinha.
    sinal: new AbortController().signal,
  });

  return resultado.ok;
}
