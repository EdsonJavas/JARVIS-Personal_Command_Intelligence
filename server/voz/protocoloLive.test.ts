import { describe, expect, it } from "vitest";
import {
  paraEsquemaGoogle,
  quadroDeAudio,
  quadroDeResultado,
  quadroDeSetup,
  quadroDeTexto,
} from "./protocoloLive";

describe("esquema no dialeto do Google", () => {
  it("sobe o tipo para maiúsculas, recursivamente", () => {
    const convertido = paraEsquemaGoogle({
      type: "object",
      properties: {
        titulo: { type: "string", description: "um título" },
        itens: { type: "array", items: { type: "object", properties: { n: { type: "integer" } } } },
      },
      required: ["titulo"],
    });

    expect(convertido.type).toBe("OBJECT");
    const props = convertido.properties as Record<string, { type: string }>;
    expect(props.titulo.type).toBe("STRING");
    expect(props.itens.type).toBe("ARRAY");
    expect(convertido.required).toEqual(["titulo"]);
  });

  it("poda as chaves que o Google recusa — é o que quebra as ferramentas MCP", () => {
    const convertido = paraEsquemaGoogle({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      additionalProperties: false,
      default: {},
      type: "object",
      properties: { x: { type: "string", additionalProperties: false } },
    });

    expect(convertido).not.toHaveProperty("$schema");
    expect(convertido).not.toHaveProperty("additionalProperties");
    expect(convertido).not.toHaveProperty("default");
    expect(convertido.properties).toEqual({ x: { type: "STRING" } });
  });

  it("esquema sem tipo ganha um: sem ele o Google recusa o parâmetro", () => {
    expect(paraEsquemaGoogle({ properties: { a: { description: "x" } } }).type).toBe("OBJECT");
    expect(paraEsquemaGoogle({}).type).toBe("OBJECT");
  });
});

describe("quadros do protocolo", () => {
  it("o setup pede áudio em pt-BR, com transcrição dos dois lados e sessão longa", () => {
    const s = JSON.parse(
      quadroDeSetup({
        modelo: "gemini-2.5-flash-native-audio-latest",
        instrucao: "Você é o JARVIS.",
        ferramentas: [{ name: "x", description: "d", parameters: { type: "OBJECT", properties: {} } }],
        voz: "Charon",
      })
    ).setup;

    expect(s.model).toBe("models/gemini-2.5-flash-native-audio-latest");
    expect(s.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(s.generationConfig.speechConfig.languageCode).toBe("pt-BR");
    expect(s.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Charon");
    expect(s.inputAudioTranscription).toBeDefined();
    expect(s.outputAudioTranscription).toBeDefined();
    // As duas chaves que impedem a sessão de morrer no meio da conversa.
    expect(s.contextWindowCompression).toEqual({ slidingWindow: {} });
    expect(s.sessionResumption).toEqual({});
    expect(s.tools[0].functionDeclarations).toHaveLength(1);
  });

  it("com handle, o setup pede retomada em vez de sessão nova", () => {
    const s = JSON.parse(
      quadroDeSetup({ modelo: "m", instrucao: "i", ferramentas: [], retomada: "h-123" })
    ).setup;
    expect(s.sessionResumption).toEqual({ handle: "h-123" });
    // Sem ferramenta, a chave nem aparece.
    expect(s.tools).toBeUndefined();
  });

  it("áudio vai em base64 com a taxa declarada", () => {
    const q = JSON.parse(quadroDeAudio(Buffer.from([0, 1, 2, 3]), 16000));
    expect(q.realtimeInput.audio.mimeType).toBe("audio/pcm;rate=16000");
    expect(Buffer.from(q.realtimeInput.audio.data, "base64")).toEqual(Buffer.from([0, 1, 2, 3]));
  });

  it("texto é um turno completo — é assim que se testa sem microfone", () => {
    const q = JSON.parse(quadroDeTexto("bom dia"));
    expect(q.clientContent.turns[0].parts[0].text).toBe("bom dia");
    expect(q.clientContent.turnComplete).toBe(true);
  });

  it("o id da chamada volta idêntico no resultado", () => {
    const q = JSON.parse(
      quadroDeResultado([{ id: "fc_1", name: "estado_da_maquina", resultado: "CPU 12%" }])
    );
    expect(q.toolResponse.functionResponses[0].id).toBe("fc_1");
    expect(q.toolResponse.functionResponses[0].name).toBe("estado_da_maquina");
    expect(q.toolResponse.functionResponses[0].response.output).toBe("CPU 12%");
  });
});
