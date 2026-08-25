import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventoBrutoJarvis } from "@shared/jarvisStream";
import { JarvisProviderError, generateJarvisReply } from "./jarvisAi";

const originalKey = process.env.GEMINI_API_KEY;
const originalGenericKey = process.env.LLM_API_KEY;
const originalBaseUrl = process.env.LLM_BASE_URL;
const originalModel = process.env.LLM_MODEL;

beforeEach(() => {
  process.env.LLM_API_KEY = "test-provider-key";
  process.env.LLM_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
  process.env.LLM_MODEL = "gemini-3.6-flash";
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.GEMINI_API_KEY = originalKey;
  process.env.LLM_API_KEY = originalGenericKey;
  process.env.LLM_BASE_URL = originalBaseUrl;
  process.env.LLM_MODEL = originalModel;
});

/** Resposta do provedor só com texto. */
function respostaTexto(texto: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content: texto } }] }), {
    status: 200,
  });
}

/** Resposta do provedor pedindo uma ferramenta, opcionalmente com narração. */
function respostaFerramenta(
  nome: string,
  args: Record<string, unknown>,
  conteudo?: string,
  id = "call_1"
) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            content: conteudo ?? null,
            tool_calls: [
              {
                id,
                type: "function",
                function: { name: nome, arguments: JSON.stringify(args) },
              },
            ],
          },
        },
      ],
    }),
    { status: 200 }
  );
}

function corpoDaChamada(mock: ReturnType<typeof vi.fn>, indice: number) {
  return JSON.parse(String((mock.mock.calls[indice]?.[1] as RequestInit).body));
}

describe("generateJarvisReply", () => {
  it("envia conversa contextual e o catálogo de ferramentas ao endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaTexto("Claro, senhor. Vamos começar."));
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await generateJarvisReply([
      { role: "user", content: "Organize meu dia." },
      { role: "assistant", content: "Qual é sua principal prioridade?" },
      { role: "user", content: "Finalizar o Jarvis." },
    ]);

    expect(resultado).toMatchObject({
      reply: "Claro, senhor. Vamos começar.",
      model: "gemini-3.6-flash",
      actions: [],
      motivoDeParada: "concluido",
    });
    expect(resultado.fala).toBeTruthy();

    const payload = corpoDaChamada(fetchMock, 0);
    expect(payload.messages[0]).toMatchObject({ role: "system" });
    expect(payload.messages).toHaveLength(4);
    // O catálogo viaja em toda chamada: é o que permite pedir ação em vez de
    // descrever o que faria.
    expect(payload.tool_choice).toBe("auto");
    expect(payload.tools.map((t: any) => t.function.name)).toContain("executar_powershell");
  });

  it("explica quando a chave não foi configurada", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.LLM_API_KEY;

    await expect(
      generateJarvisReply([{ role: "user", content: "Olá" }])
    ).rejects.toMatchObject({ kind: "missing_key" } as Partial<JarvisProviderError>);
  });

  it("explica quando a cota do provedor foi atingida sem nada executado", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(async () =>
          new Response(
            JSON.stringify({
              error: {
                details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }],
              },
            }),
            { status: 429 }
          )
        )
    );

    await expect(
      generateJarvisReply([{ role: "user", content: "Olá" }])
    ).rejects.toMatchObject({ kind: "quota_exceeded" } as Partial<JarvisProviderError>);
  });

  it.each([
    ["Gemini", "https://generativelanguage.googleapis.com/v1beta/openai", "gemini-3.6-flash"],
    ["Groq", "https://api.groq.com/openai/v1", "llama-3.3-70b-versatile"],
    ["OpenRouter", "https://openrouter.ai/api/v1", "openrouter/free"],
    ["OpenAI", "https://api.openai.com/v1", "gpt-4o-mini"],
  ])("mantém o contrato chat/completions para %s", async (_provedor, baseUrl, model) => {
    process.env.LLM_BASE_URL = baseUrl;
    process.env.LLM_MODEL = model;
    const fetchMock = vi.fn().mockResolvedValue(respostaTexto("Resposta compatível."));
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await generateJarvisReply([{ role: "user", content: "Teste" }]);

    expect(resultado).toMatchObject({ reply: "Resposta compatível.", model, actions: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      `${baseUrl}/chat/completions`,
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer test-provider-key" }),
      })
    );
  });

  it("executa a ferramenta pedida e devolve o resultado ao provedor", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaFerramenta("buscar_na_web", { consulta: "" }))
      .mockResolvedValueOnce(respostaTexto("Consulta vazia, senhor."));
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await generateJarvisReply([{ role: "user", content: "pesquise" }]);

    expect(resultado.reply).toBe("Consulta vazia, senhor.");
    expect(resultado.actions).toHaveLength(1);
    expect(resultado.actions[0]).toMatchObject({ name: "buscar_na_web", ok: false });

    // O par assistente/ferramenta precisa viajar junto e na ordem: sem ele o
    // provedor recusa a resposta de ferramenta como órfã.
    const segunda = corpoDaChamada(fetchMock, 1);
    const papeis = segunda.messages.map((m: any) => m.role);
    expect(papeis.slice(-2)).toEqual(["assistant", "tool"]);
    expect(segunda.messages.at(-1)).toMatchObject({ tool_call_id: "call_1" });
  });

  it("texto junto de tool_calls vira narração; a resposta final não vira", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaFerramenta("limpar_painel", {}, "Vou conferir lá fora, senhor."))
      .mockResolvedValueOnce(respostaTexto("Está fazendo vinte e quatro graus."));
    vi.stubGlobal("fetch", fetchMock);

    const eventos: EventoBrutoJarvis[] = [];
    const resultado = await generateJarvisReply([{ role: "user", content: "e o tempo?" }], {
      aoEvento: (evento) => eventos.push(evento),
    });

    const narracoes = eventos.filter((e) => e.tipo === "narracao");
    expect(narracoes).toHaveLength(1);
    expect(narracoes[0]).toMatchObject({ origem: "modelo" });
    // A resposta final não pode virar narração, senão é falada duas vezes.
    expect(narracoes.some((n) => "texto" in n && n.texto === resultado.reply)).toBe(false);
  });

  it("não repete a mesma narração em rodadas seguidas", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaFerramenta("limpar_painel", {}, "Vou conferir.", "c1"))
      // Mesma frase, caixa e pontuação diferentes: continua sendo a mesma fala.
      .mockResolvedValueOnce(respostaFerramenta("mostrar_no_painel", { titulo: "t", itens: [{ texto: "x" }] }, "vou conferir!", "c2"))
      .mockResolvedValueOnce(respostaTexto("Pronto, senhor."));
    vi.stubGlobal("fetch", fetchMock);

    const eventos: EventoBrutoJarvis[] = [];
    await generateJarvisReply([{ role: "user", content: "veja" }], {
      aoEvento: (evento) => eventos.push(evento),
    });

    const narracoes = eventos.filter((e) => e.tipo === "narracao");
    const ditas = narracoes.map((e) => (e as { texto: string }).texto);

    // A frase repetida do modelo é falada UMA vez.
    expect(ditas.filter((texto) => /vou conferir/i.test(texto))).toHaveLength(1);

    // E a segunda ação, cuja narração foi barrada por repetição, se anuncia
    // sozinha: ficar muda seria executar sem dizer o que está executando.
    expect(ditas.some((texto) => /painel/i.test(texto))).toBe(true);
  });

  it("chamada sem narração do modelo ganha anúncio ANTES de executar", async () => {
    // A ordem tem que ser pensar, falar, executar. O modelo costuma chamar a
    // ferramenta calado; sem isto, a primeira coisa que acontecia era a
    // execução, e a fala só vinha na resposta final.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaFerramenta("limpar_painel", {}, undefined, "c1"))
      .mockResolvedValueOnce(respostaTexto("Pronto, senhor."));
    vi.stubGlobal("fetch", fetchMock);

    const eventos: EventoBrutoJarvis[] = [];
    await generateJarvisReply([{ role: "user", content: "limpe" }], {
      aoEvento: (evento) => eventos.push(evento),
    });

    const posNarracao = eventos.findIndex((e) => e.tipo === "narracao");
    const posAcao = eventos.findIndex((e) => e.tipo === "acao_inicio");

    expect(posNarracao).toBeGreaterThanOrEqual(0);
    expect(posAcao).toBeGreaterThanOrEqual(0);
    // O anúncio vem ANTES do início da ação, não depois.
    expect(posNarracao).toBeLessThan(posAcao);
  });

  it("cancelamento interrompe o laço e não produz resposta falada", async () => {
    const controle = new AbortController();
    const fetchMock = vi.fn().mockImplementation(async () => {
      // Cancela assim que a primeira chamada retorna, antes da segunda rodada.
      controle.abort();
      return respostaFerramenta("limpar_painel", {});
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await generateJarvisReply([{ role: "user", content: "veja" }], {
      sinal: controle.signal,
    });

    expect(resultado.motivoDeParada).toBe("cancelado");
    expect(resultado.reply).toBe("");
    expect(resultado.fala).toBe("");
    // Uma única chamada ao provedor: o laço parou de verdade.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("o histórico de entrada com ações chega ao provedor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaTexto("Certo."));
    vi.stubGlobal("fetch", fetchMock);

    await generateJarvisReply([
      { role: "user", content: "quantos arquivos tem no downloads?" },
      {
        role: "assistant",
        content: "Trinta e sete, senhor.",
        acoes: [{ name: "executar_powershell", detail: "contagem", ok: true, resumo: "37" }],
      },
      { role: "user", content: "e quantos são pdf?" },
    ]);

    const payload = corpoDaChamada(fetchMock, 0);
    const doAssistente = payload.messages.find((m: any) => m.role === "assistant");
    // É isto que impede o Jarvis de refazer a medição que acabou de fazer.
    expect(doAssistente.content).toContain("executar_powershell");
    expect(doAssistente.content).toContain("37");
  });

  it("fechamento por orçamento vai sem ferramentas e produz texto", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const corpo = JSON.parse(String(init.body));
      if (corpo.tool_choice === "none") return respostaTexto("Fechando, senhor.");
      return respostaFerramenta("limpar_painel", {}, undefined, `c${fetchMock.mock.calls.length}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await generateJarvisReply([{ role: "user", content: "faça" }], {
      orcamento: { maxRodadas: 2 },
    });

    expect(resultado.motivoDeParada).toBe("orcamento");
    expect(resultado.reply).toBe("Fechando, senhor.");

    const ultima = corpoDaChamada(fetchMock, fetchMock.mock.calls.length - 1);
    expect(ultima.tool_choice).toBe("none");
    expect(ultima.tools).toBeUndefined();
  });

  it("fechamento vazio produz resposta determinística em vez de erro", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const corpo = JSON.parse(String(init.body));
      if (corpo.tool_choice === "none") return respostaTexto("");
      return respostaFerramenta("limpar_painel", {}, undefined, `c${fetchMock.mock.calls.length}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await generateJarvisReply([{ role: "user", content: "faça" }], {
      orcamento: { maxRodadas: 2 },
    });

    // Várias execuções reais não podem virar mensagem de erro genérica.
    expect(resultado.reply).toMatch(/aç(ão|ões)/);
    expect(resultado.actions.length).toBeGreaterThan(0);
  });

  it("cota estourada no meio de um run com ações vira fechamento, não erro", async () => {
    let chamada = 0;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const corpo = JSON.parse(String(init.body));
      if (corpo.tool_choice === "none") return respostaTexto("Consegui parte, senhor.");
      chamada += 1;
      if (chamada === 1) return respostaFerramenta("limpar_painel", {});
      return new Response(JSON.stringify({ error: {} }), { status: 429 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await generateJarvisReply([{ role: "user", content: "faça" }]);

    expect(resultado.motivoDeParada).toBe("orcamento");
    expect(resultado.reply).toBe("Consegui parte, senhor.");
  });

  it("a mesma chamada repetida é barrada antes de executar de novo", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const corpo = JSON.parse(String(init.body));
      if (corpo.tool_choice === "none") return respostaTexto("Fim.");
      // Sempre a MESMA chamada, com os mesmos argumentos.
      return respostaFerramenta("limpar_painel", {}, undefined, `c${fetchMock.mock.calls.length}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await generateJarvisReply([{ role: "user", content: "faça" }], {
      orcamento: { maxRodadas: 4 },
    });

    // Executou uma vez; as repetições viraram aviso, não nova execução.
    expect(resultado.actions).toHaveLength(1);
  });

  it("pergunta repetida e barrada CONSOME orçamento em vez de girar de graça", async () => {
    // Perguntar é de graça de propósito, senão o modelo aprende a não perguntar.
    // Mas a gratuidade era decidida pelo NOME da ferramenta, antes da
    // deduplicação: quando o modelo repetia a mesma pergunta, nada executava e a
    // rodada ainda assim saía sem custo. O laço girava até estourar o relógio —
    // dezenas de chamadas ao provedor, tela só com "pensando", nada feito.
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const corpo = JSON.parse(String(init.body));
      if (corpo.tool_choice === "none") return respostaTexto("Fim.");
      return respostaFerramenta(
        "perguntar_ao_usuario",
        { pergunta: "Qual pasta o senhor quer?" },
        undefined,
        `c${fetchMock.mock.calls.length}`
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const resultado = await generateJarvisReply([{ role: "user", content: "faça" }], {
      orcamento: { maxRodadas: 3 },
      // Sem interatividade a pergunta volta na hora, em vez de esperar a
      // expiração: o que este teste mede é a contabilidade da rodada, não a
      // espera por gente.
      interativo: false,
    });

    // Três rodadas mais o fechamento. Sem a correção, a rodada barrada não
    // custava nada e isto passava de dez, parando só no relógio.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(5);
    expect(resultado.reply.length).toBeGreaterThan(0);
  });
});
