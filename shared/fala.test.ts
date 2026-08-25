import { describe, expect, it } from "vitest";
import { prepararFala, LIMITE_FALA } from "./fala";

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
