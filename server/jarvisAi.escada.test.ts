import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateJarvisReply } from "./jarvisAi";
import { limparEsgotados } from "./jarvis/modelos";

/**
 * Onde o modelo lento pode ser gasto.
 *
 * Medido: `gemini-3.6-flash` responde uma saudação em 5,7 s; `gemini-3.7-flash`
 * em 12,9 s, porque raciocina antes. Gastar o profundo nas rodadas que escolhem
 * ferramenta somaria 77 s antes da primeira palavra. Ele só entra na chamada
 * que ESCREVE a resposta — uma por turno, e mascarada pelo streaming.
 */

const original = { ...process.env };

beforeEach(() => {
  process.env.LLM_API_KEY = "chave-de-teste";
  process.env.LLM_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
  delete process.env.LLM_MODEL;
  delete process.env.LLM_MODELS;
  delete process.env.JARVIS_MODELO_PROFUNDO;
  limparEsgotados();
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.assign(process.env, {
    LLM_API_KEY: original.LLM_API_KEY,
    LLM_BASE_URL: original.LLM_BASE_URL,
    LLM_MODEL: original.LLM_MODEL,
    LLM_MODELS: original.LLM_MODELS,
  });
  limparEsgotados();
});

const texto = (t: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content: t } }] }), { status: 200 });

const ferramenta = (nome: string, id: string) =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{ id, type: "function", function: { name: nome, arguments: "{}" } }],
          },
        },
      ],
    }),
    { status: 200 }
  );

const corpos = (m: ReturnType<typeof vi.fn>) =>
  m.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)));

describe("escada rápida × profunda", () => {
  it("rodada de ferramenta NUNCA usa modelo pro, mesmo em pergunta difícil", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => ferramenta("limpar_painel", "c1"))
      .mockImplementationOnce(async () => texto("Porque o indexador ainda roda, senhor."));
    vi.stubGlobal("fetch", fetchMock);

    await generateJarvisReply([
      { role: "user", content: "por que o Cursor está lento? compare com ontem" },
    ]);

    const primeira = corpos(fetchMock)[0];
    expect(primeira.model).not.toMatch(/pro/);
    expect(primeira.reasoning_effort).toBe("low");
  });

  it("o fechamento de pergunta difícil sobe para a escada profunda", async () => {
    // Estoura o orçamento para chegar ao fechamento.
    const fetchMock = vi.fn().mockImplementation(async () => ferramenta("limpar_painel", "c1"));
    vi.stubGlobal("fetch", fetchMock);

    await generateJarvisReply(
      [{ role: "user", content: "analisa os repositórios e explica onde eu devia mexer" }],
      { orcamento: { maxRodadas: 1 } }
    );

    const fechamento = corpos(fetchMock).at(-1)!;
    expect(fechamento.model).toMatch(/pro/);
    expect(fechamento.reasoning_effort).toBe("high");
    // O fechamento também transmite: sem isto a resposta inteira era bufferizada.
    expect(fechamento.stream).toBe(true);
  });

  it("pergunta trivial fecha na escada rápida", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => ferramenta("limpar_painel", "c1"));
    vi.stubGlobal("fetch", fetchMock);

    await generateJarvisReply([{ role: "user", content: "limpa o painel" }], {
      orcamento: { maxRodadas: 1 },
    });

    const fechamento = corpos(fetchMock).at(-1)!;
    expect(fechamento.model).not.toMatch(/pro/);
  });

  it("JARVIS_MODELO_PROFUNDO=0 volta tudo ao comportamento de antes", async () => {
    process.env.JARVIS_MODELO_PROFUNDO = "0";
    const fetchMock = vi.fn().mockImplementation(async () => ferramenta("limpar_painel", "c1"));
    vi.stubGlobal("fetch", fetchMock);

    await generateJarvisReply([{ role: "user", content: "explica por que isso acontece" }], {
      orcamento: { maxRodadas: 1 },
    });

    expect(corpos(fetchMock).at(-1)!.model).not.toMatch(/pro/);
    delete process.env.JARVIS_MODELO_PROFUNDO;
  });

  it("provedor que recusa reasoning_effort é atendido sem ele, uma vez só", async () => {
    const recusa = () =>
      new Response(
        JSON.stringify({ error: { message: "Unknown parameter: reasoning_effort" } }),
        { status: 400 }
      );
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => recusa())
      .mockImplementation(async () => texto("Feito, senhor."));
    vi.stubGlobal("fetch", fetchMock);

    const resposta = await generateJarvisReply([{ role: "user", content: "oi" }]);

    expect(resposta.reply).toBe("Feito, senhor.");
    expect(corpos(fetchMock)[0].reasoning_effort).toBeDefined();
    expect(corpos(fetchMock)[1].reasoning_effort).toBeUndefined();
  });
});
