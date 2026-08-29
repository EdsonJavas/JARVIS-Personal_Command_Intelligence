import { describe, expect, it } from "vitest";
import { criarFalaEmFluxo, separarFrases } from "./falaEmFluxo";

describe("separar frases", () => {
  it("fecha a frase no ponto seguido de maiúscula, e guarda o resto", () => {
    const { prontas, resto } = separarFrases("O disco tem 220 gigas livres. A memória está em");
    expect(prontas).toEqual(["O disco tem 220 gigas livres."]);
    expect(resto).toBe("A memória está em");
  });

  it("não corta em ponto de número, abreviação ou versão", () => {
    const { prontas, resto } = separarFrases("Custa R$ 1.200,50 na versão 3.2 do Dr. Silva");
    expect(prontas).toEqual([]);
    expect(resto).toBe("Custa R$ 1.200,50 na versão 3.2 do Dr. Silva");
  });

  it("quebra de linha fecha a frase mesmo sem ponto", () => {
    const { prontas, resto } = separarFrases("Três processos pesados agora\nO Chrome lidera");
    expect(prontas).toEqual(["Três processos pesados agora"]);
    expect(resto).toBe("O Chrome lidera");
  });

  it("frase curta demais se junta à seguinte", () => {
    const { prontas } = separarFrases("Sim. O disco está com folga, senhor. E a");
    expect(prontas).toEqual(["Sim. O disco está com folga, senhor."]);
  });
});

describe("fala em fluxo", () => {
  it("fala cada frase assim que ela fecha, e só o que falta no final", () => {
    const fluxo = criarFalaEmFluxo();

    expect(fluxo.receber("O disco tem ")).toEqual([]);
    expect(fluxo.receber("220 gigas livres. A mem")).toEqual(["O disco tem 220 gigas livres."]);
    expect(fluxo.receber("ória está em 40%. Tudo")).toEqual(["A memória está em 40%."]);

    // O final repete tudo; o que sobra é só o pedaço que nunca fechou.
    expect(
      fluxo.concluir("O disco tem 220 gigas livres. A memória está em 40%. Tudo em ordem, senhor.")
    ).toEqual(["Tudo em ordem, senhor."]);
  });

  it("sem fluxo, o final é falado inteiro", () => {
    const fluxo = criarFalaEmFluxo();
    expect(fluxo.concluir("Está tudo em ordem, senhor.")).toEqual(["Está tudo em ordem, senhor."]);
  });

  it("markdown some da voz mas não atrapalha a comparação com o final", () => {
    const fluxo = criarFalaEmFluxo();
    expect(fluxo.receber("**Chrome** usa 2 GB. O ")).toEqual(["Chrome usa 2 GB."]);
    expect(fluxo.concluir("**Chrome** usa 2 GB. O resto é leve.")).toEqual(["O resto é leve."]);
  });

  it("texto que virou narração não é dito duas vezes", () => {
    const fluxo = criarFalaEmFluxo();
    fluxo.receber("Vou conferir o disco agora mesmo. Depois a mem");
    // O servidor manda o texto da rodada como narração: só o que faltou sai.
    expect(fluxo.concluir("Vou conferir o disco agora mesmo. Depois a memória.")).toEqual([
      "Depois a memória.",
    ]);
    // Frase curta demais para fechar sozinha fica para o final — e SÓ ela.
    fluxo.receber("Abrindo o navegador agora. Pronto.\n");
    expect(fluxo.concluir("Abrindo o navegador agora. Pronto.")).toEqual(["Pronto."]);
    // Tudo dito: nada sai de novo.
    fluxo.receber("Está feito, senhor. Mais alguma coisa?\n");
    expect(fluxo.concluir("Está feito, senhor. Mais alguma coisa?")).toEqual([]);
  });

  it("nova rodada descarta o que ficou sem fechar", () => {
    const fluxo = criarFalaEmFluxo();
    fluxo.receber("Metade de uma fr");
    fluxo.novaRodada();
    expect(fluxo.receber("Frase nova, inteira e sem resto.\n")).toEqual([
      "Frase nova, inteira e sem resto.",
    ]);
  });

  it("se o final diverge do que foi dito, fala o final inteiro", () => {
    // O modelo pode reescrever ao fechar. Melhor repetir do que engolir.
    const fluxo = criarFalaEmFluxo();
    fluxo.receber("Vou conferir o disco agora. ");
    expect(fluxo.concluir("O disco está com 220 gigas livres.")).toEqual([
      "O disco está com 220 gigas livres.",
    ]);
  });
});

describe("resposta em duas partes", () => {
  it("a voz para na linha em branco: o detalhe é para a tela", () => {
    const fluxo = criarFalaEmFluxo();

    // As duas frases do guia saem; a linha em branco fecha a segunda.
    expect(fluxo.receber("Ele está com quase dois gigas, senhor. Deixei na tela.\n\n")).toEqual([
      "Ele está com quase dois gigas, senhor.",
      "Deixei na tela.",
    ]);
    // Daqui para baixo é tela, e a voz fica muda.
    expect(fluxo.receber("## Detalhe\n\n| processo | memória |\n| Cursor | 1,87 GB |\n")).toEqual([]);
    expect(fluxo.receber("Mais uma frase inteira que não deve ser falada. E outra.\n")).toEqual([]);
  });

  it("concluir compara contra a parte falada, não contra o texto inteiro", () => {
    const fluxo = criarFalaEmFluxo();
    fluxo.receber("Ele está com quase dois gigas, senhor. ");

    const falta = fluxo.concluir(
      "Ele está com quase dois gigas, senhor. Deixei na tela.\n\n| a | b |\n|---|---|\n| 1 | 2 |"
    );

    expect(falta.join(" ")).not.toContain("|");
    expect(falta.join(" ")).toContain("Deixei na tela.");
  });

  it("resposta de uma parte só continua como sempre foi", () => {
    const fluxo = criarFalaEmFluxo();
    expect(fluxo.concluir("Sobrou um giga e meio, senhor.")).toEqual([
      "Sobrou um giga e meio, senhor.",
    ]);
  });

  it("nova rodada reabre a voz — o guia fechado não vale para o turno seguinte", () => {
    const fluxo = criarFalaEmFluxo();
    fluxo.receber("Vou conferir agora. Já volto.\n\ndetalhe qualquer\n");
    fluxo.novaRodada();

    expect(fluxo.receber("Agora sim, a resposta de verdade. E esta segunda também.\n")).toEqual([
      "Agora sim, a resposta de verdade.",
      "E esta segunda também.",
    ]);
  });
});
