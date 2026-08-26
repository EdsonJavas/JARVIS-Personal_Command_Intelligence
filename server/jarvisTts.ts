import { JarvisProviderError } from "./jarvisAi";
import { aparar, chaveDaFala, gravarNoCache, lerDoCache, type FalaSintetizada } from "./vozCache";
import { marcarEsgotada, podeSintetizar, registrarUso, type Prioridade } from "./vozOrcamento";
import {
  assinaturaDaProsodia,
  sintetizarLocal,
  vozLocalDisponivel,
  vozLocalPadrao,
} from "./vozLocal";
import {
  assinaturaMicrosoft,
  sintetizarMicrosoft,
  vozMicrosoftLigada,
} from "./vozMicrosoft";

const DEFAULT_TTS_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_TTS_MODEL = "gemini-3.1-flash-tts-preview";
/** Voz masculina, timbre informativo — a mais próxima do Jarvis de referência. */
const DEFAULT_TTS_VOICE = "Charon";

/** A síntese é lenta e cobra por caractere; textos longos são truncados. */
const MAX_SPEECH_CHARS = 1200;

/**
 * Direção de atuação. O modelo aceita instrução de estilo em linguagem natural
 * antes do texto; é o que separa uma leitura mecânica de uma locução com
 * intenção.
 */
const STYLE_DIRECTION =
  "Você é o assistente pessoal de confiança do seu senhor: sereno, atento e " +
  "discreto. Diga a frase abaixo em português do Brasil como quem fala ao lado " +
  "dele, em tom baixo e natural — entonação viva porém contida, leve calor na " +
  "voz, pausas curtas onde a pontuação pede. Nada de ênfase artificial, nada de " +
  "locutor de propaganda. Não leia esta instrução, apenas a frase:";

function getTtsConfiguration() {
  const apiKey = process.env.LLM_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new JarvisProviderError(
      "missing_key",
      "A chave de IA ainda não foi configurada no projeto."
    );
  }

  return {
    apiKey,
    baseUrl: (process.env.TTS_BASE_URL?.trim() || DEFAULT_TTS_BASE_URL).replace(/\/+$/, ""),
    model: process.env.TTS_MODEL?.trim() || DEFAULT_TTS_MODEL,
    voice: process.env.TTS_VOICE?.trim() || DEFAULT_TTS_VOICE,
  };
}

/** Lê a taxa de amostragem do mimeType (`audio/L16;codec=pcm;rate=24000`). */
function parseSampleRate(mimeType: string | undefined): number {
  const match = mimeType?.match(/rate=(\d+)/i);
  return match ? Number(match[1]) : 24000;
}

/**
 * Envelopa PCM cru num contêiner WAV.
 *
 * A API devolve L16 sem cabeçalho, e nenhum navegador toca isso direto. São 44
 * bytes de RIFF na frente — mais barato que decodificar no cliente e funciona
 * tanto em <audio> quanto no Web Audio.
 */
function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // tamanho do bloco fmt
  header.writeUInt16LE(1, 20); // PCM sem compressão
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

function describeTtsFailure(status: number) {
  if (status === 401 || status === 403) {
    return "A chave de IA foi recusada pelo provedor de voz.";
  }
  if (status === 404) {
    return "O modelo de voz configurado não está disponível para esta chave.";
  }
  if (status === 429) {
    return "O limite de uso da síntese de voz foi atingido. A resposta segue em texto.";
  }
  if (status >= 500) {
    return "O provedor de voz está indisponível no momento.";
  }
  return "O provedor não conseguiu sintetizar esta fala.";
}

/**
 * Sínteses em voo, por chave.
 *
 * Sem isto, duas janelas abertas — o núcleo e o painel — pedindo a mesma frase
 * ao mesmo tempo pagariam a síntese duas vezes. A segunda espera a primeira.
 */
const emVoo = new Map<string, Promise<FalaSintetizada>>();

/**
 * De qual motor é este identificador de voz?
 *
 * Os dois formatos são convenientemente distintos: a Microsoft usa hífen
 * ("pt-BR-AntonioNeural") e o Piper usa sublinhado ("pt_BR-faber-medium").
 * Sem separar, escolher uma voz do Piper no seletor mandaria o id para a
 * Microsoft, que recusaria — e o Jarvis cairia no Piper por acidente, com um
 * aviso de falha no log a cada frase.
 */
function motorDaVoz(vozId?: string): "microsoft" | "piper" | "qualquer" {
  if (!vozId) return "qualquer";
  if (vozId.startsWith("pt_")) return "piper";
  if (vozId.startsWith("pt-")) return "microsoft";
  return "qualquer";
}

export async function synthesizeSpeech(
  text: string,
  opcoes: { prioridade?: Prioridade; voz?: string } = {}
): Promise<FalaSintetizada> {
  const trimmed = text.trim().slice(0, MAX_SPEECH_CHARS);

  if (!trimmed) {
    throw new JarvisProviderError("invalid_reply", "Não há texto para sintetizar.");
  }

  /*
   * PRIMEIRO a voz neural da Microsoft, falada pelo servidor.
   *
   * É a mais humana das três, e a única que o dono aprovou de ouvido depois de
   * comparar. Não depende de navegador nem de cota; depende de internet e de um
   * endpoint que a Microsoft controla — por isso vem antes, mas nunca sozinha.
   */
  const motor = motorDaVoz(opcoes.voz);

  if (vozMicrosoftLigada() && motor !== "piper") {
    const vozMs = motor === "microsoft" ? opcoes.voz : undefined;
    const chaveMs = chaveDaFala(
      trimmed,
      "microsoft",
      vozMs ? `${vozMs}_${assinaturaMicrosoft()}` : assinaturaMicrosoft()
    );

    const guardadaMs = await lerDoCache(chaveMs);
    if (guardadaMs) return guardadaMs;

    try {
      const fala = await sintetizarMicrosoft(trimmed, vozMs);
      const pronta: FalaSintetizada = {
        audio: fala.audio.toString("base64"),
        mimeType: fala.mimeType,
        model: "microsoft",
        voice: fala.voz,
      };
      await gravarNoCache(chaveMs, pronta);
      void aparar();
      return pronta;
    } catch (erro) {
      // Sem rede, ou serviço mudado: cai para o Piper, que roda na máquina. O
      // aviso fica no log para a queda não passar despercebida por semanas.
      console.warn("[Voz] Microsoft indisponível:", String(erro).slice(0, 140));
    }
  }

  /*
   * A VOZ LOCAL É O CAMINHO PRINCIPAL.
   *
   * Roda na máquina, é ilimitada, offline, e soa igual em qualquer navegador —
   * que é exatamente o que faltava. A síntese do Gemini fica como reserva para
   * quando o Piper não estiver instalado.
   */
  if (vozLocalDisponivel()) {
    // Voz da Microsoft não serve ao Piper: cai no padrão local em vez de falhar.
    const vozId = (motor === "piper" ? opcoes.voz : undefined) ?? vozLocalPadrao()?.id;
    /*
     * A prosódia entra na chave.
     *
     * Sem isto, mudar ritmo ou entonação não teria efeito nenhum sobre as frases
     * já sintetizadas — e são justamente os anúncios de ação, as mais faladas.
     * O ajuste pareceria não funcionar.
     */
    const chaveLocal = chaveDaFala(
      trimmed,
      `piper:${assinaturaDaProsodia()}`,
      vozId ?? "padrao"
    );

    const guardadaLocal = await lerDoCache(chaveLocal);
    if (guardadaLocal) return guardadaLocal;

    try {
      const wav = await sintetizarLocal(trimmed, vozId);
      const fala: FalaSintetizada = {
        audio: wav.toString("base64"),
        mimeType: "audio/wav",
        model: "piper",
        voice: vozId ?? "padrao",
      };
      await gravarNoCache(chaveLocal, fala);
      void aparar();
      return fala;
    } catch (erro) {
      // Piper quebrado não pode emudecer o Jarvis: cai para o caminho do Gemini,
      // e o aviso fica no log para o defeito não passar despercebido.
      console.warn("[Voz] síntese local falhou:", String(erro).slice(0, 160));
    }
  }

  /*
   * Daqui para baixo é o caminho do Gemini, e só agora a chave é exigida: pedi-la
   * antes faria o Jarvis ficar mudo numa instalação que tem a voz local e não
   * configurou provedor nenhum.
   */
  const { apiKey, baseUrl, model, voice } = getTtsConfiguration();
  const chave = chaveDaFala(trimmed, model, voice);

  // O cache vem antes do orçamento: o que já está sintetizado não custa cota.
  const guardada = await lerDoCache(chave);
  if (guardada) return guardada;

  const jaPedida = emVoo.get(chave);
  if (jaPedida) return jaPedida;

  /*
   * Recusa ANTES da rede quando a cota do dia acabou. Ir até a Google para
   * receber 429 custava segundos de silêncio no meio da conversa antes de o
   * cliente cair para a voz do sistema.
   */
  if (!podeSintetizar(opcoes.prioridade ?? "resposta")) {
    throw new JarvisProviderError(
      "quota_exceeded",
      "A cota diária de voz neural acabou. A fala segue na voz do sistema."
    );
  }

  const promessa = sintetizarDeVerdade(trimmed, { apiKey, baseUrl, model, voice })
    .then(async (fala) => {
      registrarUso();
      await gravarNoCache(chave, fala);
      void aparar();
      return fala;
    })
    .catch((erro) => {
      // A Google mandando 429 vale mais que a nossa contagem: o teto real pode
      // ser menor, ou a chave pode ter sido usada fora daqui.
      if (erro instanceof JarvisProviderError && erro.kind === "quota_exceeded") marcarEsgotada();
      throw erro;
    })
    .finally(() => {
      emVoo.delete(chave);
    });

  emVoo.set(chave, promessa);
  return promessa;
}

async function sintetizarDeVerdade(
  trimmed: string,
  cfg: { apiKey: string; baseUrl: string; model: string; voice: string }
): Promise<FalaSintetizada> {
  const { apiKey, baseUrl, model, voice } = cfg;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${STYLE_DIRECTION} ${trimmed}` }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
          },
        },
      }),
    });
  } catch {
    throw new JarvisProviderError(
      "provider_failure",
      "Não foi possível alcançar o provedor de voz."
    );
  }

  const payload = (await response.json().catch(() => null)) as {
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
    }>;
  } | null;

  if (!response.ok) {
    throw new JarvisProviderError(
      response.status === 429 ? "quota_exceeded" : "provider_failure",
      describeTtsFailure(response.status)
    );
  }

  const inline = payload?.candidates?.[0]?.content?.parts?.find((part) => part.inlineData)
    ?.inlineData;

  if (!inline?.data) {
    throw new JarvisProviderError(
      "invalid_reply",
      "O provedor não retornou áudio utilizável."
    );
  }

  const wav = pcmToWav(Buffer.from(inline.data, "base64"), parseSampleRate(inline.mimeType));

  return {
    audio: wav.toString("base64"),
    mimeType: "audio/wav",
    model,
    voice,
  };
}
