import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateJarvisReply } from "./jarvisAi";

/**
 * A poda de contexto não pode destruir o que foi medido.
 *
 * O defeito: a saída de qualquer ferramenta com mais de duas rodadas era
 * SOBRESCRITA por um resumo de 160 caracteres. Na rodada sete o modelo
 * concluía sobre um resumo do que tinha medido na rodada um — e a resposta
 * final, que é a que o dono lê, era escrita contra evidência picotada.
 */

const original = { ...process.env };

beforeEach(() => {
  process.env.LLM_API_KEY = "chave-de-teste";
  process.env.LLM_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
  process.env.LLM_MODEL = "modelo-de-teste";
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.LLM_API_KEY = original.LLM_API_KEY;
  process.env.LLM_BASE_URL = original.LLM_BASE_URL;
  process.env.LLM_MODEL = original.LLM_MODEL;
});

/** Uma marca improvável, para encontrar a saída original no payload. */
const MARCA = "MEDICAO-DA-RODADA-UM-4f2a9c";

function chamada(nome: string, id: string) {
  return new Response(
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
}
const texto = (t: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content: t } }] }), { status: 200 });

function corpos(mock: ReturnType<typeof vi.fn>) {
  return mock.mock.calls.map((c) => String((c[1] as RequestInit).body));
}

describe("poda não destrutiva", () => {
  it("o que foi medido na rodada 1 ainda está no payload da rodada 3", async () => {
    // `ver_area_de_transferencia` devolve o conteúdo da área — fácil de encher.
    const grande = `${MARCA} ${"x".repeat(3000)}`;
    vi.stubGlobal("navigator", undefined);

    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => chamada("limpar_painel", "c1"))
      .mockImplementationOnce(async () => chamada("limpar_painel", "c2"))
      .mockImplementationOnce(async () => chamada("limpar_painel", "c3"))
      .mockImplementationOnce(async () => texto("Pronto, senhor."));
    vi.stubGlobal("fetch", fetchMock);

    await generateJarvisReply([{ role: "user", content: `limpa o painel ${grande}` }]);

    // A fala do dono é longa e vai no histórico: se algo tivesse sido podado
    // por IDADE, a última rodada não a teria mais.
    const ultima = corpos(fetchMock).at(-1)!;
    expect(ultima).toContain(MARCA);
  });

  it("sob o orçamento, nada é encolhido entre rodadas", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => chamada("limpar_painel", "c1"))
      .mockImplementationOnce(async () => chamada("limpar_painel", "c2"))
      .mockImplementationOnce(async () => chamada("limpar_painel", "c3"))
      .mockImplementationOnce(async () => texto("Feito."));
    vi.stubGlobal("fetch", fetchMock);

    await generateJarvisReply([{ role: "user", content: "limpa o painel três vezes" }]);

    const todos = corpos(fetchMock);
    const saidaDaPrimeira = JSON.parse(todos[1]).messages.find(
      (m: { role: string }) => m.role === "tool"
    ).content;
    const naUltima = JSON.parse(todos.at(-1)!).messages.filter(
      (m: { role: string }) => m.role === "tool"
    );
    // A primeira saída de ferramenta chegou íntegra à última rodada.
    expect(naUltima[0].content).toBe(saidaDaPrimeira);
  });

  it("`_podavel` nunca viaja para o provedor", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => chamada("limpar_painel", "c1"))
      .mockImplementationOnce(async () => texto("Feito."));
    vi.stubGlobal("fetch", fetchMock);

    await generateJarvisReply([{ role: "user", content: "limpa" }]);

    for (const corpo of corpos(fetchMock)) expect(corpo).not.toContain("_podavel");
  });
});
