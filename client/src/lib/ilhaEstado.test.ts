import { describe, expect, it } from "vitest";
import { atividadeDaIlha, formaDaIlha, trechoFinal } from "./ilhaEstado";

const parado = {
  abertaPeloDono: false,
  temPergunta: false,
  aviso: null,
  emAtividade: false,
} as const;

describe("formaDaIlha", () => {
  it("fica em repouso quando nada acontece", () => {
    expect(formaDaIlha(parado)).toBe("repouso");
  });

  it("abre quando o dono abre", () => {
    expect(formaDaIlha({ ...parado, abertaPeloDono: true })).toBe("expandida");
  });

  it("abre sozinha com pergunta pendente, mesmo fechada: a execução está parada esperando", () => {
    expect(formaDaIlha({ ...parado, temPergunta: true })).toBe("expandida");
  });

  it("pergunta vence aviso e atividade", () => {
    expect(
      formaDaIlha({ ...parado, temPergunta: true, aviso: "iniciativa", emAtividade: true })
    ).toBe("expandida");
  });

  it("aviso passageiro vence atividade", () => {
    expect(formaDaIlha({ ...parado, aviso: "iniciativa", emAtividade: true })).toBe("aviso");
    expect(formaDaIlha({ ...parado, aviso: "erro" })).toBe("aviso");
  });

  it("aberta pelo dono não vira aviso: o aviso aparece dentro dela", () => {
    expect(formaDaIlha({ ...parado, abertaPeloDono: true, aviso: "iniciativa" })).toBe("expandida");
  });

  it("alarga em atividade", () => {
    expect(formaDaIlha({ ...parado, emAtividade: true })).toBe("atividade");
  });
});

const quieto = {
  pending: false,
  narracao: null,
  respostaParcial: null,
  acoesEmCurso: [],
  aoVivoAtivo: false,
  aoVivoConectando: false,
  aoVivoFalando: false,
  vozFalando: false,
  ultimaResposta: null,
} as const;

describe("atividadeDaIlha", () => {
  it("nada acontecendo não é atividade", () => {
    expect(atividadeDaIlha(quieto)).toBeNull();
  });

  it("conectando a voz ao vivo", () => {
    expect(atividadeDaIlha({ ...quieto, aoVivoConectando: true })).toEqual({
      tipo: "conectando",
      texto: "conectando…",
    });
  });

  it("pensando sem narração diz que está pensando", () => {
    expect(atividadeDaIlha({ ...quieto, pending: true })).toEqual({
      tipo: "pensando",
      texto: "pensando…",
    });
  });

  it("pensando mostra a narração antes da ação em curso", () => {
    const atividade = atividadeDaIlha({
      ...quieto,
      pending: true,
      narracao: "Vou medir a máquina.",
      acoesEmCurso: [{ detalhe: "CPU e memória" }],
    });
    expect(atividade).toEqual({ tipo: "pensando", texto: "Vou medir a máquina." });
  });

  it("sem narração, mostra a última ação em curso", () => {
    const atividade = atividadeDaIlha({
      ...quieto,
      pending: true,
      acoesEmCurso: [{ detalhe: "listar processos" }, { detalhe: "CPU e memória" }],
    });
    expect(atividade).toEqual({ tipo: "pensando", texto: "CPU e memória" });
  });

  it("escrevendo a resposta já conta como falando, com o fim do texto", () => {
    const atividade = atividadeDaIlha({
      ...quieto,
      pending: true,
      respostaParcial: "A CPU está em 12%. A memória",
    });
    expect(atividade?.tipo).toBe("falando");
    expect(atividade?.texto).toBe("A CPU está em 12%. A memória");
  });

  it("ao vivo e ele falando", () => {
    expect(
      atividadeDaIlha({ ...quieto, aoVivoAtivo: true, aoVivoFalando: true, respostaParcial: "Pois não." })
    ).toEqual({ tipo: "falando", texto: "Pois não." });
  });

  it("ao vivo e calado é ouvindo, com o que o dono acabou de dizer", () => {
    expect(atividadeDaIlha({ ...quieto, aoVivoAtivo: true })).toEqual({
      tipo: "ouvindo",
      texto: "ouvindo",
    });
    expect(atividadeDaIlha({ ...quieto, aoVivoAtivo: true, narracao: "que horas são" })).toEqual({
      tipo: "ouvindo",
      texto: "que horas são",
    });
  });

  it("a voz terminando de ler a resposta, já fora da execução", () => {
    expect(
      atividadeDaIlha({ ...quieto, vozFalando: true, ultimaResposta: "Tudo certo, senhor." })
    ).toEqual({ tipo: "falando", texto: "Tudo certo, senhor." });
  });
});

describe("trechoFinal", () => {
  it("devolve o texto inteiro quando cabe", () => {
    expect(trechoFinal("Tudo certo.", 40)).toBe("Tudo certo.");
  });

  it("corta pelo começo, numa fronteira de palavra, e marca o corte", () => {
    const texto = "A CPU está em doze por cento e a memória em quarenta e oito";
    const trecho = trechoFinal(texto, 30);
    expect(trecho.startsWith("…")).toBe(true);
    expect(trecho.length).toBeLessThanOrEqual(30);
    expect(texto.endsWith(trecho.slice(1))).toBe(true);
    expect(trecho.slice(1).startsWith(" ")).toBe(false);
  });

  it("junta espaços e quebras de linha", () => {
    expect(trechoFinal("  linha um\n\nlinha   dois  ", 40)).toBe("linha um linha dois");
  });

  it("tira marcação de markdown que não faz sentido numa linha só", () => {
    expect(trechoFinal("**Pronto**: `npm` rodou", 40)).toBe("Pronto: npm rodou");
  });
});
