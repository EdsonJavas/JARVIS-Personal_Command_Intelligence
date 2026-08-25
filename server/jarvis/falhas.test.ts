import { describe, expect, it } from "vitest";
import {
  assinaturaDaChamada,
  avaliarTentativa,
  deveDesistir,
  type RegistroDeTentativa,
} from "./falhas";

describe("assinatura de chamada", () => {
  it("ignora ordem de chaves e espaços em volta", () => {
    // O modelo emite JSON com ordem variável entre rodadas; sem normalizar, a
    // deduplicação nunca dispararia.
    const a = assinaturaDaChamada("f", '{"a":1,"b":"x"}');
    const b = assinaturaDaChamada("f", '{"b":"x" ,  "a":1}');
    expect(a).toBe(b);
  });

  it("normaliza espaço em volta de valor de texto", () => {
    expect(assinaturaDaChamada("f", '{"p":" x "}')).toBe(assinaturaDaChamada("f", '{"p":"x"}'));
  });

  it("distingue ferramentas diferentes com os mesmos argumentos", () => {
    expect(assinaturaDaChamada("a", "{}")).not.toBe(assinaturaDaChamada("b", "{}"));
  });
});

describe("avaliar tentativa", () => {
  it("permite a primeira chamada", () => {
    expect(avaliarTentativa([], "f", "f::{}")).toEqual({ permitir: true });
  });

  it("barra a repetição idêntica que já funcionou", () => {
    const historico: RegistroDeTentativa[] = [{ ferramenta: "f", assinatura: "f::{}", ok: true }];
    const decisao = avaliarTentativa(historico, "f", "f::{}");
    expect(decisao.permitir).toBe(false);
    if (!decisao.permitir) expect(decisao.aviso).toContain("já executou");
  });

  it("barra a repetição idêntica que já falhou, orientando outro caminho", () => {
    const historico: RegistroDeTentativa[] = [{ ferramenta: "f", assinatura: "f::{}", ok: false }];
    const decisao = avaliarTentativa(historico, "f", "f::{}");
    expect(decisao.permitir).toBe(false);
    if (!decisao.permitir) expect(decisao.aviso).toContain("caminho diferente");
  });
});

describe("desistir", () => {
  const falha = (i: number): RegistroDeTentativa => ({
    ferramenta: "f",
    assinatura: `f::${i}`,
    ok: false,
  });
  const sucesso = (i: number): RegistroDeTentativa => ({
    ferramenta: "f",
    assinatura: `f::${i}`,
    ok: true,
  });

  it("três falhas consecutivas desistem", () => {
    expect(deveDesistir([falha(1), falha(2)])).toBe(false);
    expect(deveDesistir([falha(1), falha(2), falha(3)])).toBe(true);
  });

  it("um sucesso no meio zera a contagem consecutiva", () => {
    expect(deveDesistir([falha(1), falha(2), sucesso(3), falha(4)])).toBe(false);
  });

  it("cinco falhas no turno desistem mesmo intercaladas", () => {
    expect(
      deveDesistir([falha(1), sucesso(2), falha(3), sucesso(4), falha(5), sucesso(6), falha(7), sucesso(8), falha(9)])
    ).toBe(true);
  });

  const recusa = (i: number): RegistroDeTentativa => ({
    ferramenta: "executar_powershell",
    assinatura: `f::${i}`,
    ok: false,
    recusada: true,
  });

  it("recusa do dono NÃO conta como falha", () => {
    // Ele cancelar três ações arriscadas é decisão consciente. Contando como
    // falha técnica, o turno era encerrado como fracasso e o Jarvis narrava um
    // erro que nunca aconteceu — inclusive para o resto do pedido, que não
    // precisava de autorização nenhuma.
    expect(deveDesistir([recusa(1), recusa(2), recusa(3)])).toBe(false);
    expect(deveDesistir([recusa(1), recusa(2), recusa(3), recusa(4), recusa(5)])).toBe(false);
  });

  it("recusa não quebra a sequência de falhas técnicas de verdade", () => {
    // A recusa é ignorada, não tratada como sucesso: as falhas em volta dela
    // continuam sendo consecutivas.
    expect(deveDesistir([falha(1), recusa(2), falha(3), falha(4)])).toBe(true);
  });
});

describe("recusa e deduplicação", () => {
  it("o modelo é impedido de repetir uma ação que o dono já recusou", () => {
    const historico: RegistroDeTentativa[] = [
      { ferramenta: "executar_powershell", assinatura: "x::1", ok: false, recusada: true },
    ];
    const decisao = avaliarTentativa(historico, "executar_powershell", "x::1");

    expect(decisao.permitir).toBe(false);
    if (decisao.permitir) return;
    // O aviso tem que dizer que foi RECUSA, não falha: senão o modelo tenta
    // "consertar" e pede a mesma coisa de outro jeito.
    expect(decisao.aviso).toContain("recusou");
  });
});
