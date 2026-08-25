import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

/**
 * Vozes neurais da Microsoft, alcançadas pelo SERVIDOR.
 *
 * É a resposta para o que o Senhor Edson vinha pedindo desde o começo: voz
 * fluida, com ênfase e pronúncia correta — sem depender de um navegador
 * específico, sem cota diária, sem instalar nada na máquina.
 *
 * O caminho é o serviço de leitura em voz alta do Edge, falado direto daqui. As
 * mesmas vozes que só apareciam dentro daquele navegador passam a valer no
 * Chrome, no Firefox ou em qualquer lugar, porque quem fala com o serviço é o
 * servidor, não a página.
 *
 * O PREÇO, dito por extenso: isto depende de internet e usa um endpoint que a
 * Microsoft pode mudar sem aviso. Por isso não substitui o Piper — ele continua
 * instalado, e uma falha aqui cai para ele em vez de emudecer o Jarvis.
 */

/** Escolhida de ouvido pelo dono, comparando quatro amostras. */
const VOZ_PADRAO = "pt-BR-AntonioNeural";

/**
 * Ajuste de locução.
 *
 * Um pouco mais devagar e um pouco mais grave que o padrão da Microsoft, que é
 * pensado para leitura de notícia. O dono ouviu as duas versões e escolheu esta.
 */
const RITMO_PADRAO = "-8%";
const TOM_PADRAO = "-4Hz";

/** Prazo curto: se o serviço não responde, o Piper assume sem demora perceptível. */
const TIMEOUT_MS = 12_000;
const MAX_CHARS = 1200;

export type FalaMicrosoft = { audio: Buffer; mimeType: string; voz: string };

export function vozMicrosoftLigada(): boolean {
  // Desligável por ambiente: se a Microsoft mudar o serviço e começar a devolver
  // lixo, o dono não precisa de mim para voltar ao Piper.
  return process.env.VOZ_MICROSOFT !== "0";
}

export function vozMicrosoftPadrao(): string {
  return process.env.VOZ_MICROSOFT_NOME?.trim() || VOZ_PADRAO;
}

/** Assinatura para a chave do cache: trocar voz ou ritmo tem que invalidar. */
export function assinaturaMicrosoft(): string {
  const ritmo = process.env.VOZ_MICROSOFT_RITMO?.trim() || RITMO_PADRAO;
  const tom = process.env.VOZ_MICROSOFT_TOM?.trim() || TOM_PADRAO;
  return `${vozMicrosoftPadrao()}_${ritmo}_${tom}`;
}

/** Lista as vozes brasileiras que o serviço oferece, para o seletor. */
export async function vozesMicrosoft(): Promise<{ id: string; nome: string; genero: string }[]> {
  try {
    const tts = new MsEdgeTTS();
    const todas = (await tts.getVoices()) as Array<{
      ShortName: string;
      Locale: string;
      Gender: string;
      FriendlyName?: string;
    }>;

    return todas
      .filter((voz) => String(voz.Locale).startsWith("pt-BR"))
      .map((voz) => ({
        id: voz.ShortName,
        // "pt-BR-AntonioNeural" -> "Antonio"
        nome: voz.ShortName.replace(/^pt-BR-/, "").replace(/Neural$|MultilingualNeural$/, ""),
        genero: voz.Gender,
      }));
  } catch {
    // Sem rede, a lista some do seletor em vez de mostrar opção que não fala.
    return [];
  }
}

/**
 * Sintetiza e devolve o MP3.
 *
 * MP3, e não WAV: o serviço já entrega comprimido, e são cinco vezes menos bytes
 * atravessando a conexão até o navegador — o que importa quando a fala precisa
 * começar rápido.
 */
export function sintetizarMicrosoft(
  texto: string,
  vozId?: string,
  sinal?: AbortSignal
): Promise<FalaMicrosoft> {
  return new Promise(async (resolver, rejeitar) => {
    const limpo = String(texto ?? "").trim().slice(0, MAX_CHARS);
    if (!limpo) return rejeitar(new Error("não há texto para sintetizar"));

    const voz = vozId || vozMicrosoftPadrao();
    let terminou = false;

    const prazo = setTimeout(() => {
      if (terminou) return;
      terminou = true;
      rejeitar(new Error(`o serviço de voz não respondeu em ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);

    const desistir = () => {
      if (terminou) return;
      terminou = true;
      clearTimeout(prazo);
      rejeitar(new Error("síntese interrompida"));
    };
    sinal?.addEventListener("abort", desistir, { once: true });

    try {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(voz, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

      const { audioStream } = tts.toStream(limpo, {
        rate: process.env.VOZ_MICROSOFT_RITMO?.trim() || RITMO_PADRAO,
        pitch: process.env.VOZ_MICROSOFT_TOM?.trim() || TOM_PADRAO,
      });

      const pedacos: Buffer[] = [];
      audioStream.on("data", (pedaco: Buffer) => pedacos.push(pedaco));

      audioStream.on("end", () => {
        if (terminou) return;
        terminou = true;
        clearTimeout(prazo);
        sinal?.removeEventListener("abort", desistir);

        const audio = Buffer.concat(pedacos);
        /*
         * Fluxo que termina vazio é falha, não silêncio.
         *
         * Sem esta checagem o cliente receberia um áudio de zero byte e ficaria
         * mudo sem erro nenhum — exatamente o tipo de defeito que já custou caro
         * neste projeto.
         */
        if (audio.length < 256) {
          return rejeitar(new Error("o serviço devolveu áudio vazio"));
        }
        resolver({ audio, mimeType: "audio/mpeg", voz });
      });

      audioStream.on("error", (erro: Error) => {
        if (terminou) return;
        terminou = true;
        clearTimeout(prazo);
        rejeitar(erro);
      });
    } catch (erro) {
      if (terminou) return;
      terminou = true;
      clearTimeout(prazo);
      rejeitar(erro as Error);
    }
  });
}
