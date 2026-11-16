import { describe, expect, it } from "vitest";
import { falaNestaTela, origemDaTela } from "./quemFala";

describe("falaNestaTela", () => {
  it("uma tela só sempre fala", () => {
    expect(falaNestaTela("tela", ["tela"])).toBe(true);
    expect(falaNestaTela("ilha", ["ilha"])).toBe(true);
  });

  it("com a ilha aberta, só a ilha fala: as duas saem pelo mesmo alto-falante", () => {
    const abertas = ["tela", "ilha"] as const;
    expect(falaNestaTela("ilha", abertas)).toBe(true);
    expect(falaNestaTela("tela", abertas)).toBe(false);
  });

  it("sem ilha, todas as telas falam como antes", () => {
    expect(falaNestaTela("tela", ["tela", "tela"])).toBe(true);
  });
});

describe("origemDaTela", () => {
  it("reconhece a ilha pelo parâmetro", () => {
    expect(origemDaTela("ilha")).toBe("ilha");
  });

  it("qualquer outra coisa é tela comum", () => {
    expect(origemDaTela(undefined)).toBe("tela");
    expect(origemDaTela("")).toBe("tela");
    expect(origemDaTela(["ilha", "x"])).toBe("tela");
    expect(origemDaTela("ILHA; drop table")).toBe("tela");
  });
});
