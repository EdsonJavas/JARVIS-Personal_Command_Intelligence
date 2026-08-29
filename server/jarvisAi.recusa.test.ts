import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JarvisProviderError, generateJarvisReply } from "./jarvisAi";
import { limparEsgotados, marcarEsgotado, saldoDeModelos } from "./jarvis/modelos";

/**
 * O que o rodízio faz com cada tipo de recusa.
 *
 * O defeito de origem: o 429 do teto por MINUTO era riscado como teto do DIA.
 * Uma rajada de rodadas riscava os cinco modelos em segundos, e o dono via
 * "cota esgotada" com quatro modelos livres. Medido antes de corrigir: dos
 * cinco riscados no arquivo, três responderam na hora.
 */

const original = { ...process.env };

beforeEach(() => {
  process.env.LLM_API_KEY = "chave-de-teste";
  process.env.LLM_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
  delete process.env.LLM_MODEL;
  process.env.LLM_MODELS = "modelo-a,modelo-b";
  limparEsgotados();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  process.env.LLM_API_KEY = original.LLM_API_KEY;
  process.env.LLM_BASE_URL = original.LLM_BASE_URL;
  process.env.LLM_MODEL = original.LLM_MODEL;
  process.env.LLM_MODELS = original.LLM_MODELS;
  limparEsgotados();
});

function texto(conteudo: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content: conteudo } }] }), {
    status: 200,
  });
}

/** O corpo REAL do Gemini para cada teto. */
function recusa429(quotaId: string, retryDelay = "0.05s") {
  return new Response(
    JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        details: [
          { violations: [{ quotaId }] },
          { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay },
        ],
      },
    }),
    { status: 429 }
  );
}
const DIA = "GenerateRequestsPerDayPerProjectPerModel-FreeTier";
const MINUTO = "GenerateRequestsPerMinutePerProjectPerModel-FreeTier";

/**
 * Só os modelos DESTE arquivo. Os testes rodam em paralelo por arquivo e
 * dividem o mesmo registro em disco: `modelos.test.ts` risca nomes reais ao
 * mesmo tempo, e afirmar sobre a lista inteira dependeria de quem chegou antes.
 */
function riscadosAqui(): string[] {
  return saldoDeModelos().esgotados.filter((m) => m.startsWith("modelo-"));
}

function modelosPedidos(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(
    (chamada) => JSON.parse(String((chamada[1] as RequestInit).body)).model as string
  );
}

describe("recusa por MINUTO", () => {
  it("passa ao próximo modelo SEM riscar ninguém", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(recusa429(MINUTO))
      .mockResolvedValueOnce(texto("Aqui, senhor."));
    vi.stubGlobal("fetch", fetchMock);

    const resposta = await generateJarvisReply([{ role: "user", content: "Oi" }]);

    expect(resposta.reply).toBe("Aqui, senhor.");
    expect(modelosPedidos(fetchMock)).toEqual(["modelo-a", "modelo-b"]);
    // O ponto do teste: o teto do minuto renova sozinho. Riscar era o defeito.
    expect(riscadosAqui()).toEqual([]);
  });

  it("com a fila inteira em pausa, espera o que o provedor pediu e tenta de novo UMA vez", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(recusa429(MINUTO, "0.05s")) // a
      .mockResolvedValueOnce(recusa429(MINUTO, "0.05s")) // b
      .mockResolvedValueOnce(texto("Voltei, senhor.")); // b, depois da espera
    vi.stubGlobal("fetch", fetchMock);

    const resposta = await generateJarvisReply([{ role: "user", content: "Oi" }]);

    expect(resposta.reply).toBe("Voltei, senhor.");
    expect(modelosPedidos(fetchMock)).toEqual(["modelo-a", "modelo-b", "modelo-b"]);
    expect(riscadosAqui()).toEqual([]);
  });

  it("se nem a espera resolve, o erro carrega o tempo para o botão contar", async () => {
    // Um Response novo por chamada: corpo só se lê uma vez.
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => recusa429(MINUTO, "0.05s")));

    const erro = await generateJarvisReply([{ role: "user", content: "Oi" }]).catch((e) => e);

    expect(erro).toBeInstanceOf(JarvisProviderError);
    expect(erro.kind).toBe("quota_exceeded");
    expect(erro.esperaMs).toBe(50);
    expect(riscadosAqui()).toEqual([]);
  });

  it("a espera obedece ao cancelamento", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => recusa429(MINUTO, "30s")));
    const controle = new AbortController();
    setTimeout(() => controle.abort(), 20);

    const inicio = Date.now();
    const resposta = await generateJarvisReply([{ role: "user", content: "Oi" }], {
      sinal: controle.signal,
    });

    // Não ficou preso nos 30 s, e saiu pelo caminho de cancelamento do laço.
    expect(Date.now() - inicio).toBeLessThan(2_000);
    expect(resposta.reply).toBe("");
  });
});

describe("recusa por DIA", () => {
  it("risca o modelo e passa ao próximo", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(recusa429(DIA))
      .mockResolvedValueOnce(texto("Aqui, senhor."));
    vi.stubGlobal("fetch", fetchMock);

    const resposta = await generateJarvisReply([{ role: "user", content: "Oi" }]);

    expect(resposta.reply).toBe("Aqui, senhor.");
    expect(riscadosAqui()).toEqual(["modelo-a"]);
  });

  it("com todos esgotados de verdade, é cota mesmo — sem tempo de espera", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => recusa429(DIA)));

    const erro = await generateJarvisReply([{ role: "user", content: "Oi" }]).catch((e) => e);

    expect(erro.kind).toBe("quota_exceeded");
    expect(erro.esperaMs).toBeUndefined();
    expect(riscadosAqui()).toEqual(["modelo-a", "modelo-b"]);
  });
});

describe("instabilidade (5xx)", () => {
  it("passa ao próximo modelo em vez de derrubar o turno", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("overloaded", { status: 503 }))
      .mockResolvedValueOnce(texto("Aqui, senhor."));
    vi.stubGlobal("fetch", fetchMock);

    const resposta = await generateJarvisReply([{ role: "user", content: "Oi" }]);

    expect(resposta.reply).toBe("Aqui, senhor.");
    expect(modelosPedidos(fetchMock)).toEqual(["modelo-a", "modelo-b"]);
    expect(riscadosAqui()).toEqual([]);
  });
});

describe("cura da marcação errada", () => {
  it("modelo riscado que responde é desmarcado", async () => {
    // Os dois riscados: o rodízio cai no primeiro. Ele responde — logo estava
    // vivo, e a marca era mentira.
    marcarEsgotado("modelo-a");
    marcarEsgotado("modelo-b");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(texto("Vivo, senhor.")));

    await generateJarvisReply([{ role: "user", content: "Oi" }]);

    expect(riscadosAqui()).toEqual(["modelo-b"]);
  });

  it("depois de trocar no meio do turno, a rodada seguinte continua no modelo que respondeu", async () => {
    const chamadaDeFerramenta = new Response(
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
                },
              ],
            },
          },
        ],
      }),
      { status: 200 }
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(recusa429(DIA)) // a, riscado
      .mockResolvedValueOnce(chamadaDeFerramenta) // b
      .mockResolvedValueOnce(texto("Pronto, senhor.")); // deve ser b de novo
    vi.stubGlobal("fetch", fetchMock);

    await generateJarvisReply([{ role: "user", content: "Limpa aí" }]);

    // Antes: a segunda rodada voltava ao modelo-a e pagava mais um 429.
    expect(modelosPedidos(fetchMock)).toEqual(["modelo-a", "modelo-b", "modelo-b"]);
  });
});

describe("teto de saída por fase", () => {
  function corpo(mock: ReturnType<typeof vi.fn>, i: number) {
    return JSON.parse(String((mock.mock.calls[i]?.[1] as RequestInit).body));
  }

  it("a rodada de ferramenta é apertada; a que ESCREVE a resposta é folgada", async () => {
    // Response novo por chamada: o corpo só se lê uma vez.
    const comFerramenta = () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "limpar_painel", arguments: "{}" } }] } }],
        }),
        { status: 200 }
      );
    // Estoura o orçamento para forçar o caminho de fechamento.
    const fetchMock = vi.fn().mockImplementation(async () => comFerramenta());
    vi.stubGlobal("fetch", fetchMock);

    await generateJarvisReply([{ role: "user", content: "limpa o painel" }], {
      orcamento: { maxRodadas: 2 },
    });

    const rodada = corpo(fetchMock, 0).max_tokens;
    const fechamento = corpo(fetchMock, fetchMock.mock.calls.length - 1).max_tokens;
    expect(rodada).toBe(2048);
    // Antes: 1200 para tudo, e o raciocínio comia o teto da resposta.
    expect(fechamento).toBeGreaterThan(rodada);
  });

  it("resposta vazia é repetida UMA vez com teto maior, em vez de virar 'ele travou'", async () => {
    const vazia = () => new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "" } }] }), { status: 200 });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => vazia())
      .mockImplementationOnce(async () => texto("Cento e vinte gigas livres, senhor."));
    vi.stubGlobal("fetch", fetchMock);

    const resposta = await generateJarvisReply([{ role: "user", content: "quanto de disco?" }]);

    expect(resposta.reply).toBe("Cento e vinte gigas livres, senhor.");
    expect(corpo(fetchMock, 1).max_tokens).toBeGreaterThan(corpo(fetchMock, 0).max_tokens);
  });

  it("vazia duas vezes continua sendo erro — a retentativa não vira laço", async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "" } }] }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const erro = await generateJarvisReply([{ role: "user", content: "oi" }]).catch((e) => e);
    expect(erro).toBeInstanceOf(JarvisProviderError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
