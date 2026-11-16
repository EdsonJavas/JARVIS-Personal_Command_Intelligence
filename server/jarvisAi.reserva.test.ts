import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Pasta de dados PRÓPRIA, decidida antes dos imports.
 *
 * Os arquivos de teste rodam em paralelo e o registro de modelos esgotados é um
 * arquivo em disco. Este teste risca e limpa a escada inteira várias vezes; na
 * pasta comum, atropelava o teste de rodízio que roda ao lado.
 */
vi.hoisted(() => {
  process.env.JARVIS_DATA_DIR = "data/teste/reserva";
});

import { generateJarvisReply } from "./jarvisAi";
import { limparEsgotados } from "./jarvis/modelos";

/**
 * A reserva: quando o Gemini não pode, o Groq responde.
 *
 * O que se protege aqui não é só "trocar de provedor". É trocar SEM vazar nada
 * de um para o outro — nem chave, nem a assinatura de raciocínio do Gemini 3,
 * nem a recusa de um parâmetro — e sem fazer o dono esperar um minuto que a
 * reserva tornaria desnecessário.
 */

const CHAVES = ["GEMINI_API_KEY", "GROQ_API_KEY", "GROQ_MODELS", "LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "LLM_MODELS"];
const original = Object.fromEntries(CHAVES.map((c) => [c, process.env[c]]));

beforeEach(() => {
  for (const chave of CHAVES) delete process.env[chave];
  process.env.GEMINI_API_KEY = "chave-gemini";
  process.env.GROQ_API_KEY = "chave-groq";
  limparEsgotados();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const chave of CHAVES) {
    if (original[chave] === undefined) delete process.env[chave];
    else process.env[chave] = original[chave];
  }
  limparEsgotados();
});

const ehGoogle = (url: unknown) => String(url).includes("googleapis.com");
const ehGroq = (url: unknown) => String(url).includes("api.groq.com");

const texto = (t: string) =>
  new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: t } }] }), { status: 200 });

const cotaDoDia = () =>
  new Response(
    JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }],
      },
    }),
    { status: 429 }
  );

const cotaDoMinuto = () =>
  new Response(
    JSON.stringify({
      error: {
        code: 429,
        details: [
          { violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] },
          { retryDelay: "20s" },
        ],
      },
    }),
    { status: 429 }
  );

/** Chamada de ferramenta com a assinatura opaca que o Gemini 3 manda junto. */
const ferramentaComAssinatura = () =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "c1",
                type: "function",
                function: { name: "limpar_painel", arguments: "{}" },
                extra_content: { google: { thought_signature: "assinatura-opaca" } },
              },
            ],
          },
        },
      ],
    }),
    { status: 200 }
  );

const corpo = (chamada: unknown[]) => JSON.parse(String((chamada[1] as RequestInit).body));
const autorizacao = (chamada: unknown[]) =>
  ((chamada[1] as RequestInit).headers as Record<string, string>).authorization;

describe("reserva do Groq", () => {
  it("com o Gemini esgotado no dia, o Groq responde e a resposta diz quem foi", async () => {
    const fetchMock = vi.fn(async (url: unknown) => (ehGoogle(url) ? cotaDoDia() : texto("Pelo Groq, senhor.")));
    vi.stubGlobal("fetch", fetchMock);

    const resposta = await generateJarvisReply([{ role: "user", content: "oi" }]);

    expect(resposta.reply).toBe("Pelo Groq, senhor.");
    expect(resposta.provedor).toBe("Groq");
    expect(resposta.model).toBe("openai/gpt-oss-120b");
  });

  it("cada chave vai só para o endereço dela", async () => {
    const fetchMock = vi.fn(async (url: unknown) => (ehGoogle(url) ? cotaDoDia() : texto("ok")));
    vi.stubGlobal("fetch", fetchMock);

    await generateJarvisReply([{ role: "user", content: "oi" }]);

    for (const chamada of fetchMock.mock.calls) {
      const esperada = ehGoogle(chamada[0]) ? "Bearer chave-gemini" : "Bearer chave-groq";
      expect(autorizacao(chamada)).toBe(esperada);
    }
    expect(fetchMock.mock.calls.some((c) => ehGroq(c[0]))).toBe(true);
  });

  it("a assinatura de raciocínio do Gemini não vai para o Groq", async () => {
    let doGoogle = 0;
    const fetchMock = vi.fn(async (url: unknown) => {
      if (ehGoogle(url)) {
        doGoogle += 1;
        // A primeira rodada escolhe ferramenta; depois disso, o Gemini cai.
        return doGoogle === 1 ? ferramentaComAssinatura() : new Response("{}", { status: 503 });
      }
      return texto("Painel limpo, senhor.");
    });
    vi.stubGlobal("fetch", fetchMock);

    const resposta = await generateJarvisReply([{ role: "user", content: "limpa o painel" }]);

    expect(resposta.provedor).toBe("Groq");
    const paraOGroq = fetchMock.mock.calls.filter((c) => ehGroq(c[0])).map(corpo);
    expect(paraOGroq.length).toBeGreaterThan(0);
    expect(JSON.stringify(paraOGroq)).not.toContain("extra_content");
    expect(JSON.stringify(paraOGroq)).not.toContain("assinatura-opaca");
  });

  it("com reserva, o teto do minuto não faz o dono esperar: vai direto ao Groq", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const fetchMock = vi.fn(async (url: unknown) => (ehGoogle(url) ? cotaDoMinuto() : texto("Já, senhor.")));
      vi.stubGlobal("fetch", fetchMock);

      const resposta = await generateJarvisReply([{ role: "user", content: "oi" }]);

      expect(resposta.provedor).toBe("Groq");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("o Groq recusar reasoning_effort não desliga o parâmetro para o Gemini", async () => {
    let fase: "groq-recusa" | "gemini" = "groq-recusa";
    const fetchMock = vi.fn(async (url: unknown, init: RequestInit) => {
      const pedido = JSON.parse(String(init.body));
      if (fase === "groq-recusa") {
        if (ehGoogle(url)) return cotaDoDia();
        if (pedido.reasoning_effort) {
          return new Response('{"error":{"message":"`reasoning_effort` is not supported with this model"}}', {
            status: 400,
          });
        }
        return texto("ok");
      }
      return texto("ok");
    });
    vi.stubGlobal("fetch", fetchMock);

    await generateJarvisReply([{ role: "user", content: "oi" }]);

    // Dia seguinte: a cota do Gemini voltou.
    limparEsgotados();
    fase = "gemini";
    fetchMock.mockClear();
    await generateJarvisReply([{ role: "user", content: "oi de novo" }]);

    const primeiraNoGoogle = fetchMock.mock.calls.find((c) => ehGoogle(c[0]));
    expect(primeiraNoGoogle).toBeDefined();
    expect(corpo(primeiraNoGoogle!).reasoning_effort).toBeDefined();
  });

  it("sem chave do Gemini, o Groq é o principal desde a primeira chamada", async () => {
    delete process.env.GEMINI_API_KEY;
    const fetchMock = vi.fn(async () => texto("Só Groq."));
    vi.stubGlobal("fetch", fetchMock);

    const resposta = await generateJarvisReply([{ role: "user", content: "oi" }]);

    expect(resposta.provedor).toBe("Groq");
    expect(fetchMock.mock.calls.every((c) => ehGroq(c[0]))).toBe(true);
  });

  it("sem reserva, tudo continua como antes: cota do dia esgotada é erro de cota", async () => {
    delete process.env.GROQ_API_KEY;
    vi.stubGlobal("fetch", vi.fn(async () => cotaDoDia()));

    await expect(generateJarvisReply([{ role: "user", content: "oi" }])).rejects.toMatchObject({
      kind: "quota_exceeded",
    });
  });
});
