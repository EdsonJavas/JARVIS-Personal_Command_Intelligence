import { describe, expect, it } from "vitest";
import { hasWakeWord, normalizeSpeech, requestAfterWakeWord } from "../client/src/lib/voiceWakeWord";

describe("normalizeSpeech", () => {
  it("converte para minúsculas e remove acentos", () => {
    expect(normalizeSpeech("Olá, Jarvis!")).toBe("ola jarvis");
  });

  it("remove pontuação e normaliza espaços", () => {
    expect(normalizeSpeech("Jarvis, me ajude!")).toBe("jarvis me ajude");
  });
});

describe("containsWakeWord", () => {
  it("detecta 'Jarvis' com acento ou maiúsculas", () => {
    expect(hasWakeWord("Jarvis")).toBe(true);
    expect(hasWakeWord("JARVIS")).toBe(true);
    expect(hasWakeWord("Járvis")).toBe(true);
  });

  it("detecta a palavra-chave no meio de uma frase", () => {
    expect(hasWakeWord("Ei, Jarvis, que horas são?")).toBe(true);
  });

  it("não detecta palavras similares", () => {
    expect(hasWakeWord("Jarviso")).toBe(false);
    expect(hasWakeWord("Jarv")).toBe(false);
  });
});

describe("extractRequest", () => {
  it("remove a palavra-chave e retorna o pedido", () => {
    expect(requestAfterWakeWord("Jarvis, que horas são?")).toBe("que horas são?");
    expect(requestAfterWakeWord("Jarvis me diga o clima")).toBe("me diga o clima");
  });

  it("retorna string vazia se só houver a palavra-chave", () => {
    expect(requestAfterWakeWord("Jarvis")).toBe("");
  });
});
