import { describe, expect, it } from "vitest";
import { classificarDificuldade } from "./dificuldade";

const nivel = (pedido: string, extra = {}) => classificarDificuldade({ pedido, ...extra }).nivel;

describe("classificar a dificuldade sem gastar uma chamada", () => {
  it.each([
    "oi",
    "bom dia",
    "quanto de RAM livre?",
    "que horas são?",
    "abre o Cursor",
    "aumenta o volume",
    "limpa o painel",
    "obrigado",
  ])("rápido: %s", (pedido) => {
    expect(nivel(pedido)).toBe("rapido");
  });

  it.each([
    "por que o Cursor tá lento?",
    "compare o Railway com o Fly e diga qual vale mais a pena",
    "explica como funciona o rodízio de modelos",
    "o que aconteceu com o build ontem?",
    "vale a pena migrar para Flutter 3.24?",
    "analisa os repositórios e me diz onde eu devia mexer primeiro",
  ])("profundo: %s", (pedido) => {
    expect(nivel(pedido)).toBe("profundo");
  });

  it("um turno que já executou três ações vira síntese", () => {
    expect(nivel("e agora?", { acoesExecutadas: 3 })).toBe("profundo");
    expect(nivel("e agora?", { acoesExecutadas: 1 })).toBe("rapido");
  });

  it("depois de pesquisar, o resultado precisa ser comparado", () => {
    expect(nivel("me diz o resumo disso aí", { ferramentasUsadas: ["buscar_na_web"] })).toBe(
      "profundo"
    );
  });

  it("pedido longo é profundo mesmo sem verbo de raciocínio", () => {
    expect(nivel("a".repeat(200))).toBe("profundo");
  });

  it("na dúvida, rápido — errar barato é recuperável", () => {
    expect(nivel("acha o contrato da Intellisys")).toBe("rapido");
    expect(nivel("")).toBe("rapido");
  });

  it("o motivo vem junto, para o log dizer por quê", () => {
    expect(classificarDificuldade({ pedido: "por que isso está lento?" }).motivo).toBe(
      "pede raciocínio"
    );
  });
});
