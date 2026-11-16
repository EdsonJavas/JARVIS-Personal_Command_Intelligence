import { describe, expect, it } from "vitest";
import { classificarRecusa } from "./recusa";

/** O formato REAL, copiado de uma resposta do Gemini, não inventado. */
function corpoGemini(quotaId: string, retryDelay?: string) {
  return JSON.stringify({
    error: {
      code: 429,
      message: "You exceeded your current quota, please check your plan and billing details.",
      status: "RESOURCE_EXHAUSTED",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.QuotaFailure",
          violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests", quotaId }],
        },
        ...(retryDelay ? [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay }] : []),
      ],
    },
  });
}

describe("classificar a recusa do provedor", () => {
  it("teto do DIA risca o modelo", () => {
    expect(
      classificarRecusa(429, corpoGemini("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "29s"))
    ).toEqual({ tipo: "dia" });
  });

  it("teto do MINUTO não risca, e traz a espera que o provedor pediu", () => {
    expect(
      classificarRecusa(429, corpoGemini("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "14s"))
    ).toEqual({ tipo: "minuto", esperaMs: 14_000 });
  });

  it("os dois juntos: o dia manda, esperar um minuto não devolve a cota", () => {
    const corpo = JSON.stringify({
      error: {
        details: [
          {
            violations: [
              { quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" },
              { quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" },
            ],
          },
        ],
      },
    });
    expect(classificarRecusa(429, corpo)).toEqual({ tipo: "dia" });
  });

  it("429 sem explicação erra para o lado recuperável", () => {
    // Riscado como "dia", um modelo vivo some por até 24 horas.
    expect(classificarRecusa(429, JSON.stringify({ error: { message: "quota" } }))).toEqual({
      tipo: "minuto",
      esperaMs: 15_000,
    });
    expect(classificarRecusa(429, "<html>rate limited</html>")).toMatchObject({ tipo: "minuto" });
  });

  it("espera absurda é limitada: o dono já desistiu antes disso", () => {
    expect(
      classificarRecusa(429, corpoGemini("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", "600s"))
    ).toEqual({ tipo: "minuto", esperaMs: 30_000 });
  });

  it("lê o corpo embrulhado em array, como o endpoint compatível às vezes manda", () => {
    const corpo = JSON.stringify([JSON.parse(corpoGemini("GenerateRequestsPerDayPerProjectPerModel-FreeTier"))]);
    expect(classificarRecusa(429, corpo)).toEqual({ tipo: "dia" });
  });

  it("5xx é instabilidade, não cota", () => {
    expect(classificarRecusa(503, "")).toEqual({ tipo: "instavel" });
    expect(classificarRecusa(500, "{}")).toEqual({ tipo: "instavel" });
  });

  it("chave recusada e modelo inexistente não são cota", () => {
    expect(classificarRecusa(401, "")).toEqual({ tipo: "outra" });
    expect(classificarRecusa(404, "")).toEqual({ tipo: "outra" });
  });
});

/**
 * O Groq fala de outro jeito: sem `quotaId` nem `retryDelay`, tudo na frase.
 * Formato do erro de limite documentado pelo Groq (estilo OpenAI).
 */
function corpoGroq(message: string) {
  return JSON.stringify({ error: { message, type: "tokens", code: "rate_limit_exceeded" } });
}

describe("classificar a recusa do Groq", () => {
  it("limite por DIA risca o modelo", () => {
    const corpo = corpoGroq(
      "Rate limit reached for model `llama-3.3-70b-versatile` in organization `org_x` service tier `on_demand` on requests per day (RPD): Limit 1000, Used 1000, Requested 1. Please try again in 1m26.4s."
    );
    expect(classificarRecusa(429, corpo)).toEqual({ tipo: "dia" });
  });

  it("tokens por dia também é dia", () => {
    const corpo = corpoGroq(
      "Rate limit reached for model `openai/gpt-oss-120b` on tokens per day (TPD): Limit 200000, Used 199000, Requested 2400. Please try again in 7m12s."
    );
    expect(classificarRecusa(429, corpo)).toEqual({ tipo: "dia" });
  });

  it("limite por MINUTO traz a espera escrita na frase", () => {
    const corpo = corpoGroq(
      "Rate limit reached for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Used 7000, Requested 2400. Please try again in 2.5s."
    );
    expect(classificarRecusa(429, corpo)).toEqual({ tipo: "minuto", esperaMs: 2500 });
  });

  it("espera em milissegundos e em minutos", () => {
    expect(classificarRecusa(429, corpoGroq("on requests per minute (RPM). Please try again in 640ms."))).toEqual({
      tipo: "minuto",
      esperaMs: 640,
    });
    expect(classificarRecusa(429, corpoGroq("on tokens per minute (TPM). Please try again in 1m2s."))).toEqual({
      tipo: "minuto",
      esperaMs: 30_000,
    });
  });
});
