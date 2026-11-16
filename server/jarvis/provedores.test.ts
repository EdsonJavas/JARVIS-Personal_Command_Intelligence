import { describe, expect, it } from "vitest";
import { chaveDoGemini, provedoresConfigurados } from "./provedores";

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const GROQ = "https://api.groq.com/openai/v1/chat/completions";

describe("provedoresConfigurados", () => {
  it("sem chave nenhuma, nenhum provedor", () => {
    expect(provedoresConfigurados({})).toEqual([]);
  });

  it("só o Gemini: um provedor, o Gemini", () => {
    const lista = provedoresConfigurados({ GEMINI_API_KEY: "g" });
    expect(lista.map((p) => [p.id, p.endpoint, p.apiKey])).toEqual([["gemini", GEMINI, "g"]]);
  });

  it("Gemini e Groq: o Gemini primeiro, o Groq de reserva", () => {
    const lista = provedoresConfigurados({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q" });
    expect(lista.map((p) => [p.id, p.endpoint, p.apiKey])).toEqual([
      ["gemini", GEMINI, "g"],
      ["groq", GROQ, "q"],
    ]);
  });

  it("só o Groq: ele vira o principal", () => {
    expect(provedoresConfigurados({ GROQ_API_KEY: "q" }).map((p) => p.id)).toEqual(["groq"]);
  });

  it("o Groq tem a própria escada, com modelos que chamam ferramenta", () => {
    const [, groq] = provedoresConfigurados({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q" });
    const escada = groq.modelos("rapido");
    expect(escada[0]).toBe("openai/gpt-oss-120b");
    expect(escada).toContain("llama-3.3-70b-versatile");
    expect(escada.some((m) => m.startsWith("gemini"))).toBe(false);
    expect(groq.modelos("profundo")[0]).toBe("openai/gpt-oss-120b");
  });

  it("GROQ_MODELS troca a escada do Groq", () => {
    const [groq] = provedoresConfigurados({ GROQ_API_KEY: "q", GROQ_MODELS: "a, b ,c" });
    expect(groq.modelos("rapido")).toEqual(["a", "b", "c"]);
    expect(groq.modelos("profundo")).toEqual(["a", "b", "c"]);
  });

  it("configuração antiga (LLM_API_KEY sem URL) continua sendo o Gemini", () => {
    const lista = provedoresConfigurados({ LLM_API_KEY: "g" });
    expect(lista.map((p) => [p.id, p.endpoint, p.apiKey])).toEqual([["gemini", GEMINI, "g"]]);
  });

  it("LLM_BASE_URL do Google é o Gemini, com a chave do LLM_API_KEY", () => {
    const lista = provedoresConfigurados({
      LLM_API_KEY: "g",
      LLM_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    });
    expect(lista.map((p) => p.id)).toEqual(["gemini"]);
  });

  it("LLM_BASE_URL de outro lugar é um provedor personalizado, à frente do Groq", () => {
    const lista = provedoresConfigurados({
      LLM_API_KEY: "x",
      LLM_BASE_URL: "https://openrouter.ai/api/v1",
      LLM_MODEL: "meta/llama",
      GROQ_API_KEY: "q",
    });
    expect(lista.map((p) => [p.id, p.endpoint])).toEqual([
      ["personalizado", "https://openrouter.ai/api/v1/chat/completions"],
      ["groq", GROQ],
    ]);
    expect(lista[0].modelos("rapido")[0]).toBe("meta/llama");
  });

  it("personalizado apontando para o próprio Groq não aparece duas vezes", () => {
    const lista = provedoresConfigurados({
      LLM_API_KEY: "q",
      LLM_BASE_URL: "https://api.groq.com/openai/v1",
      LLM_MODEL: "llama-3.3-70b-versatile",
      GROQ_API_KEY: "q",
    });
    expect(lista.map((p) => p.endpoint)).toEqual([GROQ]);
  });

  it("com LLM_BASE_URL personalizado, o GEMINI_API_KEY entra como reserva antes do Groq", () => {
    const lista = provedoresConfigurados({
      LLM_API_KEY: "x",
      LLM_BASE_URL: "https://openrouter.ai/api/v1",
      GEMINI_API_KEY: "g",
      GROQ_API_KEY: "q",
    });
    expect(lista.map((p) => p.id)).toEqual(["personalizado", "gemini", "groq"]);
  });
});

describe("chaveDoGemini", () => {
  it("prefere a chave própria do Gemini", () => {
    expect(chaveDoGemini({ GEMINI_API_KEY: "g", LLM_API_KEY: "outra" })).toBe("g");
  });

  it("aceita LLM_API_KEY quando ela É do Gemini (configuração antiga)", () => {
    expect(chaveDoGemini({ LLM_API_KEY: "g" })).toBe("g");
    expect(
      chaveDoGemini({ LLM_API_KEY: "g", LLM_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai/" })
    ).toBe("g");
  });

  it("nunca manda ao Google a chave de outro provedor", () => {
    expect(chaveDoGemini({ LLM_API_KEY: "q", LLM_BASE_URL: "https://api.groq.com/openai/v1" })).toBeUndefined();
    expect(chaveDoGemini({ GROQ_API_KEY: "q" })).toBeUndefined();
  });
});

describe("o nome que a ilha mostra", () => {
  it("cada provedor diz quem é", () => {
    const lista = provedoresConfigurados({
      LLM_API_KEY: "x",
      LLM_BASE_URL: "https://openrouter.ai/api/v1",
      GEMINI_API_KEY: "g",
      GROQ_API_KEY: "q",
    });
    expect(lista.map((p) => p.nome)).toEqual(["openrouter.ai", "Gemini", "Groq"]);
  });
});
