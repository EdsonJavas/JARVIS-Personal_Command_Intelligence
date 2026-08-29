import { describe, expect, it } from "vitest";
import { dividirResposta, falaDaResposta, pareceComando, prepararFala, LIMITE_FALA } from "./fala";

describe("preparar fala", () => {
  it("remove marcação, emoji e endereço, preservando o nome do arquivo", () => {
    const texto =
      "**Achei** o `contrato.pdf` em C:\\Users\\es553\\Documents\\Fiscal\\contrato.pdf 🎉 veja https://exemplo.com/pagina/x";
    const fala = prepararFala(texto);

    expect(fala).not.toContain("**");
    expect(fala).not.toContain("`");
    expect(fala).not.toContain("🎉");
    // O caminho completo não se lê em voz alta; o nome do arquivo sim.
    expect(fala).not.toContain("C:\\Users");
    expect(fala).toContain("contrato.pdf");
    // Do endereço sobra o domínio, não a URL inteira.
    expect(fala).not.toContain("https://");
    expect(fala).toContain("exemplo.com");
  });

  it("remove marcadores de lista sem colar as palavras", () => {
    const fala = prepararFala("- primeiro\n- segundo\n1. terceiro");
    expect(fala).not.toMatch(/^[-*]/m);
    expect(fala).toContain("primeiro");
    expect(fala).toContain("terceiro");
  });

  it("corta em fronteira de frase, nunca no meio de um número", () => {
    const frase = "Sobrou um giga e meio de oito. ";
    const texto = frase.repeat(30);
    const fala = prepararFala(texto);

    expect(fala.length).toBeLessThanOrEqual(LIMITE_FALA);
    // Cortar no meio produziria "um giga e"; terminar em ponto é o esperado.
    expect(fala.trim().endsWith(".")).toBe(true);
  });

  it("frase única muito longa volta inteira em vez de ser cortada no meio", () => {
    // Sem pontuação onde cortar, entregar a frase inteira é melhor do que
    // entregar meia frase.
    const texto = "a".repeat(LIMITE_FALA + 200);
    expect(prepararFala(texto)).toHaveLength(LIMITE_FALA + 200);
  });

  it("texto curto atravessa sem alteração de conteúdo", () => {
    const texto = "Treze gigas e meio livres, Senhor Edson.";
    expect(prepararFala(texto)).toBe(texto);
  });

  it("texto vazio devolve vazio", () => {
    expect(prepararFala("")).toBe("");
    expect(prepararFala("   ")).toBe("");
  });
});

describe("comando não se soletra", () => {
  it("reconhece comando por cmdlet, flag, pipe, variável ou npm/git", () => {
    expect(pareceComando("Get-Process -Name chrome")).toBe(true);
    expect(pareceComando("npm run dev")).toBe(true);
    expect(pareceComando("dir | findstr log")).toBe(true);
    expect(pareceComando("$env:PATH")).toBe(true);
    // E NÃO confunde nome de arquivo nem palavra comum com comando.
    expect(pareceComando("contrato.pdf")).toBe(false);
    expect(pareceComando("Cursor")).toBe(false);
    expect(pareceComando("segunda-feira")).toBe(false);
  });

  it("trecho entre crases que é comando vira 'o comando'; nome de arquivo continua", () => {
    const fala = prepararFala("Rodei `Get-ChildItem -Recurse | Measure-Object` e achei o `contrato.pdf`.");
    expect(fala).toBe("Rodei o comando e achei o contrato.pdf.");
  });

  it("comando solto no texto, sem crase, também some", () => {
    const fala = prepararFala("Usei Stop-Process -Name chrome -Force para encerrar. Ficou leve, senhor.");
    expect(fala).toBe("Usei o comando para encerrar. Ficou leve, senhor.");
  });
});

describe("dividir a resposta em falada e escrita", () => {
  it("a abertura vira fala; a tabela fica na tela", () => {
    const texto =
      "Ele está com quase dois gigas, senhor, e o indexador ainda roda.\n\n" +
      "| processo | memória |\n|---|---|\n| Cursor | 1,87 GB |";
    const { fala, detalhe } = dividirResposta(texto);

    expect(fala).toBe("Ele está com quase dois gigas, senhor, e o indexador ainda roda.");
    expect(fala).not.toContain("|");
    expect(detalhe).toContain("Cursor");
  });

  it("sem linha em branco, tudo continua sendo fala — o pior caso é o de antes", () => {
    const texto = "Sobrou um giga e meio de oito, senhor.";
    expect(dividirResposta(texto)).toEqual({ fala: texto, detalhe: "" });
  });

  it("abertura que começa com estrutura não é fala: o modelo não seguiu o contrato", () => {
    for (const inicio of ["## Resumo", "- primeiro item da lista", "| a | b |", "1. primeiro passo"]) {
      const texto = `${inicio}\n\nO resto do texto vem aqui, com folga.`;
      expect(dividirResposta(texto).fala).toBe(texto);
      expect(dividirResposta(texto).detalhe).toBe("");
    }
  });

  it("abertura curta demais é título disfarçado, não fala", () => {
    const texto = "Disco C\n\nDuzentos e vinte gigas livres de um total de trezentos.";
    expect(dividirResposta(texto).fala).toBe(texto);
  });

  it("falaDaResposta higieniza e respeita o teto, sobre a abertura", () => {
    const texto =
      "Achei o **contrato.pdf** em Downloads, senhor.\n\n" +
      "Caminho: `C:\Users\es553\Downloads\contrato.pdf`\n\n```powershell\nGet-Item x\n```";
    const fala = falaDaResposta(texto);

    expect(fala).toBe("Achei o contrato.pdf em Downloads, senhor.");
    expect(fala).not.toContain("**");
    expect(fala).not.toContain("Get-Item");
    expect(fala.length).toBeLessThanOrEqual(LIMITE_FALA);
  });

  it("texto vazio não quebra", () => {
    expect(dividirResposta("")).toEqual({ fala: "", detalhe: "" });
    expect(dividirResposta("   \n\n   ")).toEqual({ fala: "", detalhe: "" });
  });
});
