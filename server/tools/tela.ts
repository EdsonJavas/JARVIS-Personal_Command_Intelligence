import { modeloAtual } from "../jarvis/modelos";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AvaliacaoDeRisco, ToolDefinition } from "./registry";
import { runPowerShell } from "./shell";
import { JarvisProviderError } from "../jarvisAi";

/**
 * Ver a tela.
 *
 * É o que separa "responda sobre o computador" de "olhe o que estou olhando".
 * Com isso o Senhor Edson pode apontar para o monitor e perguntar que erro é
 * aquele, sem transcrever nada.
 *
 * SEMPRE pede confirmação, e isso não é excesso de zelo: a tela inteira viaja
 * para o provedor de IA, com o que estiver visível — no primeiro teste que fiz,
 * o que estava na tela era o arquivo .env dele, com a chave de API dentro.
 */

const MAX_LADO = 1600;

/** Onde a captura mora enquanto é lida. Apagada logo depois. */
function caminhoDaCaptura(): string {
  return join(process.env.TEMP ?? process.env.TMP ?? ".", "jarvis-tela.png");
}

/**
 * Captura a tela toda, já reduzida.
 *
 * A redução não é economia por economia: imagem grande custa tempo de upload e
 * tokens, e o modelo não lê melhor com o dobro de pixels.
 */
async function capturar(sinal: AbortSignal): Promise<string> {
  const destino = caminhoDaCaptura();

  const comando = `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$tela = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $tela.Width, $tela.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($tela.Location, [System.Drawing.Point]::Empty, $tela.Size)
$g.Dispose()

$maior = [Math]::Max($bmp.Width, $bmp.Height)
if ($maior -gt ${MAX_LADO}) {
  $escala = ${MAX_LADO} / $maior
  $novo = New-Object System.Drawing.Bitmap ([int]($bmp.Width * $escala)), ([int]($bmp.Height * $escala))
  $g2 = [System.Drawing.Graphics]::FromImage($novo)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.DrawImage($bmp, 0, 0, $novo.Width, $novo.Height)
  $g2.Dispose(); $bmp.Dispose(); $bmp = $novo
}

$bmp.Save('${destino.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "$($bmp.Width)"
`.trim();

  const resultado = await runPowerShell(comando, { timeoutMs: 20_000, sinal });
  if (!resultado.ok) throw new Error(`não consegui capturar a tela: ${resultado.output.slice(0, 160)}`);
  return destino;
}

/** Configuração do provedor de visão. Reaproveita a mesma chave do chat. */
function configuracao() {
  const apiKey = process.env.LLM_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new JarvisProviderError("missing_key", "A chave de IA não está configurada.");

  const base = (
    process.env.LLM_BASE_URL?.trim() || "https://generativelanguage.googleapis.com/v1beta/openai/"
  ).replace(/\/+$/, "");

  return {
    apiKey,
    url: base.endsWith("/chat/completions") ? base : `${base}/chat/completions`,
    // Do rodízio, como o chat: um modelo fixo aqui gastava a cota do primeiro
    // da lista mesmo quando ele já estava esgotado.
    model: modeloAtual(),
  };
}

/**
 * Pergunta ao modelo o que há na imagem.
 *
 * O resultado volta como TEXTO, e não como imagem para o laço: assim o contrato
 * de ferramenta continua o mesmo, e a imagem — que pode conter qualquer coisa —
 * não fica guardada no histórico da conversa.
 */
async function descrever(caminho: string, pergunta: string, sinal: AbortSignal): Promise<string> {
  const { apiKey, url, model } = configuracao();
  const png = readFileSync(caminho);

  const resposta = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: pergunta },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${png.toString("base64")}` },
            },
          ],
        },
      ],
      max_tokens: 700,
    }),
    signal: sinal,
  });

  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => "");
    throw new JarvisProviderError(
      resposta.status === 429 ? "quota_exceeded" : "provider_failure",
      `O provedor recusou a leitura da tela (${resposta.status}). ${corpo.slice(0, 120)}`
    );
  }

  const dados = (await resposta.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const texto = dados.choices?.[0]?.message?.content?.trim();
  if (!texto) throw new Error("o provedor não descreveu a imagem");
  return texto;
}

/**
 * O risco é real e vale a interrupção.
 *
 * Tudo o que estiver na tela sobe para o provedor: senha à mostra, conversa
 * privada, documento de cliente. É decisão do dono a cada execução, e não uma
 * conveniência a ser presumida.
 */
function riscoDeVerATela(): AvaliacaoDeRisco {
  return {
    nivel: "destrutivo",
    resumo: "Isso envia uma foto da sua tela para o provedor de IA.",
    impacto:
      "Tudo o que estiver visível vai junto — senhas à mostra, conversas, documentos abertos.",
    chave: "ver_a_tela",
  };
}

export const verATelaFerramenta: ToolDefinition = {
  name: "ver_a_tela",
  description:
    "Tira uma foto da tela e a analisa. Use quando ele se referir ao que está vendo — 'que erro é esse?', 'o que tem na minha tela?', 'lê isso aqui pra mim' — ou quando a resposta depender de algo que só existe na tela e não num arquivo. Descreva na pergunta exatamente o que você precisa saber.",
  parameters: {
    type: "object",
    properties: {
      pergunta: {
        type: "string",
        description:
          "O que olhar na imagem, específico. Ex.: 'qual é a mensagem de erro no terminal?' em vez de 'descreva a tela'.",
      },
    },
    required: ["pergunta"],
  },
  efeito: "leitura",
  describe: (args) => `ver a tela: ${String(args.pergunta ?? "").slice(0, 60)}`,
  narrar: () => "Vou olhar sua tela.",
  risco: riscoDeVerATela,
  execute: async (args, ctx) => {
    const pergunta = String(args.pergunta ?? "").trim() || "Descreva o que há nesta tela.";
    let caminho: string | null = null;

    try {
      caminho = await capturar(ctx.sinal);
      const descricao = await descrever(caminho, pergunta, ctx.sinal);
      return { texto: descricao, ok: true };
    } catch (erro) {
      return { texto: `Não consegui ler a tela: ${String(erro).slice(0, 200)}`, ok: false };
    } finally {
      // A imagem não fica no disco depois de lida: ela pode conter qualquer
      // coisa, e guardá-la seria criar um arquivo que ninguém sabe que existe.
      if (caminho) {
        try {
          rmSync(caminho, { force: true });
        } catch {
          /* já sumiu */
        }
      }
    }
  },
};
