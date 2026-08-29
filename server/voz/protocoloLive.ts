/**
 * Os quadros do protocolo Live do Gemini, e as conversões que ele exige.
 *
 * Separado do cliente porque é a parte pura: dá para testar sem rede, e é onde
 * um provedor futuro com outro formato entraria com uma troca só.
 */

/** O que o Google manda. Só o que a ponte usa; o resto é ignorado. */
export type QuadroDoGoogle = {
  setupComplete?: Record<string, never>;
  serverContent?: {
    modelTurn?: { parts?: { inlineData?: { mimeType?: string; data?: string }; text?: string }[] };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    interrupted?: boolean;
    turnComplete?: boolean;
    generationComplete?: boolean;
  };
  toolCall?: { functionCalls?: { id?: string; name: string; args?: Record<string, unknown> }[] };
  toolCallCancellation?: { ids?: string[] };
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean };
  goAway?: { timeLeft?: string };
  usageMetadata?: Record<string, unknown>;
};

export type DeclaracaoDeFerramenta = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

/**
 * Converte o esquema JSON das nossas ferramentas para o dialeto do Google.
 *
 * Duas diferenças que causam recusa silenciosa: o `type` vai em MAIÚSCULAS, e
 * chaves de JSON Schema que o Google não conhece (`$schema`,
 * `additionalProperties`, `default`) derrubam o `setup` inteiro — o que é
 * especialmente traiçoeiro porque as ferramentas MCP trazem essas chaves.
 */
const CHAVES_ACEITAS = new Set([
  "type",
  "description",
  "properties",
  "required",
  "items",
  "enum",
  "nullable",
  "format",
]);

export function paraEsquemaGoogle(esquema: unknown): Record<string, unknown> {
  if (!esquema || typeof esquema !== "object") return { type: "OBJECT", properties: {} };
  if (Array.isArray(esquema)) return esquema as unknown as Record<string, unknown>;

  const saida: Record<string, unknown> = {};
  for (const [chave, valor] of Object.entries(esquema as Record<string, unknown>)) {
    if (!CHAVES_ACEITAS.has(chave)) continue;

    if (chave === "type" && typeof valor === "string") {
      saida.type = valor.toUpperCase();
    } else if (chave === "properties" && valor && typeof valor === "object") {
      const props: Record<string, unknown> = {};
      for (const [nome, sub] of Object.entries(valor as Record<string, unknown>)) {
        props[nome] = paraEsquemaGoogle(sub);
      }
      saida.properties = props;
    } else if (chave === "items") {
      saida.items = paraEsquemaGoogle(valor);
    } else {
      saida[chave] = valor;
    }
  }

  /*
   * Sem `type`, o Google recusa o parâmetro inteiro — então sempre há um.
   * `enum` denuncia escalar; o resto é objeto, que é o caso da raiz de uma
   * ferramenta sem argumentos e o palpite seguro para o que sobra.
   */
  if (!saida.type) saida.type = saida.enum ? "STRING" : "OBJECT";
  return saida;
}

/** Um quadro de áudio de entrada, no formato que a Live espera. */
export function quadroDeAudio(pcm: Buffer, taxa = 16000): string {
  return JSON.stringify({
    realtimeInput: {
      audio: { mimeType: `audio/pcm;rate=${taxa}`, data: pcm.toString("base64") },
    },
  });
}

/** Avisa que o dono parou de falar (ao soltar o microfone ou fechar). */
export function quadroDeFimDeAudio(): string {
  return JSON.stringify({ realtimeInput: { audioStreamEnd: true } });
}

/** Um turno de TEXTO — é assim que se testa tudo sem microfone. */
export function quadroDeTexto(texto: string, completo = true): string {
  return JSON.stringify({
    clientContent: { turns: [{ role: "user", parts: [{ text: texto }] }], turnComplete: completo },
  });
}

/** A resposta de uma ferramenta. O `id` TEM que voltar idêntico. */
export function quadroDeResultado(
  respostas: { id?: string; name: string; resultado: string }[]
): string {
  return JSON.stringify({
    toolResponse: {
      functionResponses: respostas.map((r) => ({
        ...(r.id ? { id: r.id } : {}),
        name: r.name,
        response: { output: r.resultado },
      })),
    },
  });
}

export type OpcoesDeSetup = {
  modelo: string;
  instrucao: string;
  ferramentas: DeclaracaoDeFerramenta[];
  voz?: string;
  /** Handle de uma sessão anterior, para religar sem o dono perceber. */
  retomada?: string;
};

export function quadroDeSetup(o: OpcoesDeSetup): string {
  return JSON.stringify({
    setup: {
      model: `models/${o.modelo}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          languageCode: "pt-BR",
          ...(o.voz ? { voiceConfig: { prebuiltVoiceConfig: { voiceName: o.voz } } } : {}),
        },
      },
      systemInstruction: { parts: [{ text: o.instrucao }] },
      ...(o.ferramentas.length
        ? { tools: [{ functionDeclarations: o.ferramentas }] }
        : {}),
      // A transcrição dos dois lados vem de graça e é o que alimenta a tela.
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      /*
       * As duas chaves que fazem a sessão durar: a compressão remove o teto de
       * duração, e a retomada devolve um handle para religar sem o dono ver.
       */
      contextWindowCompression: { slidingWindow: {} },
      sessionResumption: o.retomada ? { handle: o.retomada } : {},
    },
  });
}
