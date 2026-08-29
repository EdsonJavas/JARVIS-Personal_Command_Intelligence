import { describe, expect, it } from "vitest";
import type { Memoria } from "../../drizzle/schema";
import {
  acharParecida,
  radical,
  chaveDoAssunto,
  montarBlocoDeMemoria,
  normalizarTexto,
  selecionarMemorias,
  similaridade,
} from "./relevancia";

function memoria(overrides: Partial<Memoria> & { conteudo: string }): Memoria {
  return {
    id: 1,
    chave: chaveDoAssunto(overrides.conteudo),
    tipo: "fato",
    origem: "explicita",
    fixada: false,
    versao: 1,
    usos: 0,
    esquecida: false,
    expiraEm: null,
    criadaEm: new Date(),
    atualizadaEm: new Date(),
    ...overrides,
  } as Memoria;
}

describe("normalização", () => {
  it("remove acento, pontuação e caixa", () => {
    // Ditado sem acento produziria uma memória nova a cada conversa falada
    // sobre o mesmo assunto.
    expect(normalizarTexto("Café FORTE, pela manhã!")).toBe("cafe forte pela manha");
  });
});

describe("radical", () => {
  it("aproxima flexões regulares do mesmo verbo", () => {
    // Sem isto, "onde eu moro?" não acharia "o Senhor Edson mora em Marília".
    expect(radical("moro")).toBe(radical("mora"));
    expect(radical("morar")).toBe(radical("mora"));
  });

  it("corta plural", () => {
    expect(radical("projetos")).toBe(radical("projeto"));
    expect(radical("arquivos")).toBe(radical("arquivo"));
  });

  it("não encurta palavra curta a ponto de confundir", () => {
    expect(radical("cpu").length).toBeGreaterThanOrEqual(3);
    expect(radical("ram").length).toBeGreaterThanOrEqual(3);
  });

  it("NÃO resolve verbo irregular — limite conhecido da comparação léxica", () => {
    // "prefiro" e "prefere" têm radicais diferentes. Resolver isso exigiria
    // embeddings, deliberadamente fora desta rodada.
    expect(radical("prefiro")).not.toBe(radical("prefere"));
  });
});

describe("similaridade", () => {
  it("reconhece a mesma coisa dita de outro jeito", () => {
    expect(similaridade("Edson prefere café forte", "edson prefere cafe bem forte")).toBeGreaterThan(
      0.6
    );
  });

  it("casa a pergunta com a memória apesar da flexão", () => {
    expect(similaridade("O Senhor Edson mora em Marília", "onde eu moro")).toBeGreaterThan(0.12);
  });

  it("separa assuntos diferentes", () => {
    expect(similaridade("Edson prefere café forte", "o disco C está com 45% usado")).toBeLessThan(
      0.2
    );
  });

  it("texto vazio não casa com nada", () => {
    expect(similaridade("", "qualquer coisa")).toBe(0);
  });
});

describe("chave do assunto", () => {
  it("é estável entre variações de escrita", () => {
    expect(chaveDoAssunto("Edson prefere café forte")).toBe(
      chaveDoAssunto("edson prefere CAFE forte")
    );
  });

  it("difere entre assuntos distintos", () => {
    expect(chaveDoAssunto("prefere café forte")).not.toBe(chaveDoAssunto("mora em Marília"));
  });
});

describe("seleção de memórias", () => {
  it("fixada entra antes de qualquer pontuada", () => {
    const escolhidas = selecionarMemorias(
      [
        memoria({ id: 1, conteudo: "assunto sem relação nenhuma com a pergunta", fixada: true }),
        memoria({ id: 2, conteudo: "o projeto principal é o imobx" }),
      ],
      "imobx"
    );
    expect(escolhidas[0].memoria.id).toBe(1);
  });

  it("correção entra mesmo sem casar lexicalmente", () => {
    // É o que o dono disse depois de o Jarvis errar; sumir por não casar
    // palavra é justamente o pior caso.
    const escolhidas = selecionarMemorias(
      [memoria({ id: 9, conteudo: "não chamar de Rafa, o nome é Edson", tipo: "correcao" })],
      "qual meu nome mesmo"
    );
    expect(escolhidas).toHaveLength(1);
  });

  it("bônus sozinho NÃO faz uma memória irrelevante entrar", () => {
    // O piso vale sobre a relevância, não sobre o total: aplicado ao total, os
    // bônus passavam sozinhos e toda preferência entrava em toda pergunta.
    const escolhidas = selecionarMemorias(
      [memoria({ id: 7, conteudo: "prefere café forte pela manhã", tipo: "preferencia" })],
      "quanto de disco tem livre"
    );
    expect(escolhidas).toHaveLength(0);
  });

  it("assunto sem relação nenhuma fica de fora", () => {
    const escolhidas = selecionarMemorias(
      [memoria({ id: 3, conteudo: "prefere café forte pela manhã" })],
      "quanto espaço tem no disco"
    );
    expect(escolhidas).toHaveLength(0);
  });

  it("respeita o orçamento de caracteres e o teto de itens", () => {
    const muitas = Array.from({ length: 100 }, (_, i) =>
      memoria({ id: i + 1, conteudo: `projeto numero ${i} com descricao ` + "x".repeat(60) })
    );
    const escolhidas = selecionarMemorias(muitas, "projeto", { orcamento: 400, maxItens: 5 });

    expect(escolhidas.length).toBeLessThanOrEqual(5);
    const total = escolhidas.reduce((soma, item) => soma + item.memoria.conteudo.length, 0);
    expect(total).toBeLessThanOrEqual(400);
  });

  it("memória esquecida ou vencida nunca entra", () => {
    const escolhidas = selecionarMemorias(
      [
        memoria({ id: 1, conteudo: "o projeto imobx foi cancelado", esquecida: true }),
        memoria({
          id: 2,
          conteudo: "o projeto imobx entrega hoje",
          expiraEm: new Date(Date.now() - 1000),
        }),
      ],
      "imobx"
    );
    expect(escolhidas).toHaveLength(0);
  });

  it("lista vazia devolve bloco vazio, sem cabeçalho", () => {
    // Um cabeçalho sozinho convidaria o modelo a inventar fatos sobre o dono.
    expect(montarBlocoDeMemoria([])).toBe("");
  });
});

describe("achar parecida", () => {
  it("acha a mesma informação escrita de outro jeito", () => {
    const achada = acharParecida(
      [memoria({ id: 4, conteudo: "Edson prefere café forte pela manhã" })],
      "edson prefere cafe bem forte pela manha"
    );
    expect(achada?.id).toBe(4);
  });

  it("não acha quando o assunto é outro", () => {
    expect(
      acharParecida([memoria({ id: 4, conteudo: "prefere café forte" })], "o disco está cheio")
    ).toBeNull();
  });

  it("ignora memória esquecida", () => {
    expect(
      acharParecida(
        [memoria({ id: 4, conteudo: "prefere café forte", esquecida: true })],
        "prefere cafe forte"
      )
    ).toBeNull();
  });
});

describe("achar o que ele guardou", () => {
  const memoria = (id: number, conteudo: string, extra: Partial<Memoria> = {}) =>
    ({
      id,
      conteudo,
      chave: `k${id}`,
      tipo: "fato",
      origem: "explicita",
      fixada: false,
      esquecida: false,
      versao: 1,
      usos: 0,
      expiraEm: null,
      criadaEm: new Date(),
      atualizadaEm: new Date(),
      ...extra,
    }) as Memoria;

  const corpo = [
    memoria(1, "O Senhor trabalha no Cursor para programar."),
    memoria(2, "O Senhor mora em Marília, São Paulo."),
    memoria(3, "O Senhor prefere café sem açúcar."),
    memoria(4, "O Senhor é desenvolvedor Flutter."),
  ];
  const achou = (consulta: string, id: number) =>
    selecionarMemorias(corpo, consulta).some((s) => s.memoria.id === id);

  it("sinônimo: 'qual editor eu uso?' recupera o Cursor", () => {
    // Zero tokens em comum com a memória — era o caso que falhava.
    expect(achou("qual editor eu uso?", 1)).toBe(true);
  });

  it("'em que cidade eu moro?' continua achando Marília", () => {
    expect(achou("em que cidade eu moro?", 2)).toBe(true);
  });

  it("'que linguagem eu programo?' acha o Flutter", () => {
    expect(achou("que linguagem eu programo?", 4)).toBe(true);
  });

  it("REGRESSÃO: pergunta de disco não puxa a preferência de café", () => {
    expect(achou("quanto sobrou de disco?", 3)).toBe(false);
  });

  it("o piso continua valendo — não é para trazer tudo", () => {
    expect(selecionarMemorias(corpo, "quanto sobrou de disco?")).toHaveLength(0);
  });
});
