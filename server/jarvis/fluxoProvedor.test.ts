import { describe, expect, it } from "vitest";
import { aplicarDelta, lerQuadros, montarMensagem, novoEstado } from "./fluxoProvedor";

describe("acumular texto", () => {
  it("junta os pedaços e devolve só o que é novo", () => {
    const estado = novoEstado();
    expect(aplicarDelta(estado, { content: "Boa " })).toBe("Boa ");
    expect(aplicarDelta(estado, { content: "noite," })).toBe("noite,");
    expect(aplicarDelta(estado, { content: " Senhor." })).toBe(" Senhor.");
    expect(estado.texto).toBe("Boa noite, Senhor.");
  });

  it("pedaço sem texto não inventa conteúdo", () => {
    const estado = novoEstado();
    expect(aplicarDelta(estado, {})).toBe("");
    expect(aplicarDelta(estado, { content: null })).toBe("");
    expect(montarMensagem(estado).content).toBeNull();
  });
});

describe("remontar chamadas de ferramenta", () => {
  it("CONCATENA os argumentos em vez de substituir", () => {
    // É o defeito mais fácil de cometer aqui: cada pedaço traz um trecho do
    // JSON, e sobrescrever deixaria só o último fragmento — um JSON truncado
    // que o modelo pareceria ter pedido.
    const estado = novoEstado();
    aplicarDelta(estado, { tool_calls: [{ index: 0, id: "c1", function: { name: "buscar_arquivos" } }] });
    aplicarDelta(estado, { tool_calls: [{ index: 0, function: { arguments: '{"pasta":' } }] });
    aplicarDelta(estado, { tool_calls: [{ index: 0, function: { arguments: '"C:/temp"}' } }] });

    const mensagem = montarMensagem(estado);
    expect(mensagem.tool_calls).toHaveLength(1);
    expect(mensagem.tool_calls![0].function.name).toBe("buscar_arquivos");
    expect(JSON.parse(mensagem.tool_calls![0].function.arguments)).toEqual({ pasta: "C:/temp" });
  });

  it("mantém chamadas separadas mesmo com fragmentos intercalados", () => {
    const estado = novoEstado();
    aplicarDelta(estado, { tool_calls: [{ index: 0, id: "a", function: { name: "um", arguments: '{"x' } }] });
    aplicarDelta(estado, { tool_calls: [{ index: 1, id: "b", function: { name: "dois", arguments: '{"y' } }] });
    aplicarDelta(estado, { tool_calls: [{ index: 0, function: { arguments: '":1}' } }] });
    aplicarDelta(estado, { tool_calls: [{ index: 1, function: { arguments: '":2}' } }] });

    const chamadas = montarMensagem(estado).tool_calls!;
    expect(chamadas.map((c) => c.function.name)).toEqual(["um", "dois"]);
    expect(JSON.parse(chamadas[0].function.arguments)).toEqual({ x: 1 });
    expect(JSON.parse(chamadas[1].function.arguments)).toEqual({ y: 2 });
  });

  it("índice ausente conta como a primeira chamada", () => {
    // Alguns provedores omitem o índice quando há uma só.
    const estado = novoEstado();
    aplicarDelta(estado, { tool_calls: [{ id: "c", function: { name: "ver", arguments: "{}" } }] });
    expect(montarMensagem(estado).tool_calls).toHaveLength(1);
  });

  it("inventa um id quando o provedor não manda", () => {
    // O id casa a resposta da ferramenta com a chamada; sem ele o laço não
    // consegue devolver o resultado.
    const estado = novoEstado();
    aplicarDelta(estado, { tool_calls: [{ index: 0, function: { name: "ver" } }] });
    expect(montarMensagem(estado).tool_calls![0].id).toBeTruthy();
  });

  it("fragmento sem nome nunca vira chamada", () => {
    // Executar uma ferramenta sem nome seria erro; descartar é o certo.
    const estado = novoEstado();
    aplicarDelta(estado, { tool_calls: [{ index: 0, function: { arguments: "{}" } }] });
    expect(montarMensagem(estado).tool_calls).toBeUndefined();
  });

  it("argumentos vazios viram objeto vazio, não string vazia", () => {
    // JSON.parse("") estoura; o laço trata "{}" sem reclamar.
    const estado = novoEstado();
    aplicarDelta(estado, { tool_calls: [{ index: 0, id: "c", function: { name: "ver" } }] });
    expect(montarMensagem(estado).tool_calls![0].function.arguments).toBe("{}");
  });
});

describe("ler quadros SSE", () => {
  it("extrai os deltas e guarda o que ficou pela metade", () => {
    // A rede não respeita fronteira de quadro: descartar o pedaço cortado
    // perderia parte da resposta em silêncio.
    const bruto =
      'data: {"choices":[{"delta":{"content":"oi"}}]}\n' +
      'data: {"choices":[{"delta":{"content":" tudo"}}]}\n' +
      'data: {"choices":[{"delta":{"cont';

    const { deltas, resto } = lerQuadros(bruto);
    expect(deltas.map((d) => d.content)).toEqual(["oi", " tudo"]);
    expect(resto).toBe('data: {"choices":[{"delta":{"cont');
  });

  it("ignora [DONE] e linhas que não são dados", () => {
    const { deltas } = lerQuadros(': ping\ndata: [DONE]\n\ndata: {"choices":[{"delta":{"content":"x"}}]}\n');
    expect(deltas).toHaveLength(1);
  });

  it("quadro corrompido não derruba os outros", () => {
    const { deltas } = lerQuadros('data: {quebrado\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n');
    expect(deltas.map((d) => d.content)).toEqual(["ok"]);
  });
});

describe("campo opaco do provedor", () => {
  it("PRESERVA a assinatura de raciocínio na remontagem", () => {
    /*
     * O Gemini 3 exige que a `thought_signature` da chamada volte junto com o
     * resultado da ferramenta. Descartada, a rodada de fechamento morre com 400
     * e o dono vê a resposta genérica de fallback em vez do relato real — sem
     * nada na tela indicando o motivo.
     */
    const estado = novoEstado();
    aplicarDelta(estado, {
      tool_calls: [
        {
          index: 0,
          id: "c1",
          extra_content: { google: { thought_signature: "Ep8FCpwF..." } },
          function: { name: "estado_da_maquina", arguments: "{}" },
        },
      ],
    });

    const chamada = montarMensagem(estado).tool_calls![0];
    expect(chamada.extra_content).toEqual({
      google: { thought_signature: "Ep8FCpwF..." },
    });
  });

  it("fragmento seguinte sem o campo não apaga o que já veio", () => {
    // A assinatura chega uma vez só, junto do nome; os fragmentos de argumento
    // vêm sem ela, e sobrescrever com undefined a perderia.
    const estado = novoEstado();
    aplicarDelta(estado, {
      tool_calls: [{ index: 0, id: "c", extra_content: { google: { thought_signature: "abc" } }, function: { name: "ver" } }],
    });
    aplicarDelta(estado, { tool_calls: [{ index: 0, function: { arguments: "{}" } }] });

    expect(montarMensagem(estado).tool_calls![0].extra_content).toBeDefined();
  });

  it("provedor que não manda o campo não ganha um vazio", () => {
    // Enviar `extra_content: undefined` a um provedor que não o conhece é
    // convite a erro de validação.
    const estado = novoEstado();
    aplicarDelta(estado, { tool_calls: [{ index: 0, id: "c", function: { name: "ver", arguments: "{}" } }] });
    expect("extra_content" in montarMensagem(estado).tool_calls![0]).toBe(false);
  });
});
