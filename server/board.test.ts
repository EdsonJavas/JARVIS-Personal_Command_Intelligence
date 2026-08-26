import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  adicionarCartao,
  atualizarCartao,
  limparCartoes,
  listarCartoes,
  recarregarDoDisco,
  removerCartao,
  sanearItem,
} from "./board";

/**
 * O painel grava em `JARVIS_DATA_DIR/painel.json` — o vitest aponta essa
 * pasta para `data/teste`, então nada aqui toca o painel real do dono.
 */
beforeEach(() => {
  for (const c of listarCartoes()) removerCartao(c.id);
});
afterEach(() => {
  for (const c of listarCartoes()) removerCartao(c.id);
});

describe("sanear item", () => {
  it("cada tipo exige o que lhe dá forma", () => {
    expect(sanearItem({ tipo: "metrica", rotulo: "Livre", valor: "220", unidade: "GB", tendencia: "sobe" })).toEqual({
      tipo: "metrica",
      rotulo: "Livre",
      valor: "220",
      unidade: "GB",
      tendencia: "sobe",
    });
    expect(sanearItem({ tipo: "metrica", rotulo: "sem valor" })).toBeNull();
    expect(sanearItem({ tipo: "progresso", rotulo: "Build", valor: "137" })).toEqual({ tipo: "progresso", rotulo: "Build", valor: 100 });
    expect(sanearItem({ tipo: "link", url: "ftp://x", texto: "x" })).toBeNull();
    expect(sanearItem({ tipo: "tabela", colunas: ["a"], linhas: [] })).toBeNull();
  });

  it("tipo desconhecido vira texto em vez de derrubar o cartão", () => {
    expect(sanearItem({ tipo: "inventado", texto: "ainda assim vale" })).toEqual({
      tipo: "texto",
      texto: "ainda assim vale",
    });
  });
});

describe("cartões", () => {
  it("cartão sem item válido é recusado", () => {
    expect(adicionarCartao({ titulo: "vazio", itens: [{ tipo: "metrica" }] })).toBeNull();
  });

  it("tabela pede largura sozinha", () => {
    const c = adicionarCartao({
      titulo: "Comparação",
      itens: [{ tipo: "tabela", colunas: ["a", "b"], linhas: [["1", "2"]] }],
    });
    expect(c?.largura).toBe("largo");
  });

  it("sobrevive a reinício: o que foi gravado volta do disco", () => {
    const c = adicionarCartao({ titulo: "Persistente", itens: [{ tipo: "texto", texto: "fica" }] });
    recarregarDoDisco();
    expect(listarCartoes().map((x) => x.id)).toContain(c!.id);
  });

  it("passo marcado como feito, e fixado não cai no limpar", () => {
    const c = adicionarCartao({
      titulo: "Plano",
      itens: [{ tipo: "passo", texto: "primeiro" }, { tipo: "passo", texto: "segundo" }],
      fixado: true,
    })!;
    atualizarCartao(c.id, { passo: { indice: 1, feito: true } });
    const lido = listarCartoes().find((x) => x.id === c.id)!;
    expect(lido.itens[1]).toMatchObject({ tipo: "passo", feito: true });

    adicionarCartao({ titulo: "solto", itens: [{ tipo: "texto", texto: "vai embora" }] });
    limparCartoes();
    expect(listarCartoes().map((x) => x.titulo)).toEqual(["Plano"]);
  });
});
