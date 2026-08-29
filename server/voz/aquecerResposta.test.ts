import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O aquecimento é um adiantamento oportunista. As duas propriedades que
 * importam são: sintetizar o MESMO texto que o cliente vai pedir (senão não
 * aquece nada), e nunca atrapalhar o turno se falhar.
 */

const sintetizadas: string[] = [];
let falhar = false;

vi.mock("../jarvisTts", () => ({
  synthesizeSpeech: vi.fn(async (texto: string) => {
    if (falhar) throw new Error("cota estourada");
    sintetizadas.push(texto);
    return { audio: "", mimeType: "audio/mp3" };
  }),
}));

const { criarAquecedorDeFala } = await import("./aquecerResposta");

beforeEach(() => {
  sintetizadas.length = 0;
  falhar = false;
});
afterEach(() => vi.clearAllMocks());

describe("aquecer a fala no servidor", () => {
  it("sintetiza cada frase assim que ela fecha", () => {
    const a = criarAquecedorDeFala();
    a.receber("O disco tem 220 gigas livres. ");
    a.receber("A memória está em 40%. Tudo");

    expect(sintetizadas).toEqual(["O disco tem 220 gigas livres.", "A memória está em 40%."]);
  });

  it("higieniza igual ao cliente — a chave do cache é o texto final", () => {
    const a = criarAquecedorDeFala();
    a.receber("Achei o **contrato.pdf** em Downloads. E mais alguma coisa aqui.\n");

    // Sem asteriscos: é assim que o cliente vai pedir, e é assim que o cache indexa.
    expect(sintetizadas[0]).toBe("Achei o contrato.pdf em Downloads.");
  });

  it("não aquece o que vem depois da linha em branco: aquilo é tela", () => {
    const a = criarAquecedorDeFala();
    a.receber("Ele está com quase dois gigas, senhor. Deixei na tela.\n\n");
    a.receber("| processo | memória |\n| Cursor | 1,87 GB |\n");
    a.receber("Mais uma frase inteira que jamais deve ser falada.\n");

    expect(sintetizadas).toEqual([
      "Ele está com quase dois gigas, senhor.",
      "Deixei na tela.",
    ]);
  });

  it("não repete a mesma frase", () => {
    const a = criarAquecedorDeFala();
    a.receber("Uma frase que se repete.\n");
    a.novaRodada();
    a.receber("Uma frase que se repete.\n");

    expect(sintetizadas).toHaveLength(1);
  });

  it("falha na síntese não derruba nem propaga — é adiantamento, não obrigação", () => {
    falhar = true;
    const a = criarAquecedorDeFala();

    expect(() => a.receber("Uma frase qualquer que fecha aqui.\n")).not.toThrow();
    expect(sintetizadas).toEqual([]);
  });

  it("desligado, não sintetiza nada", () => {
    const a = criarAquecedorDeFala(false);
    a.receber("Uma frase que fecharia normalmente.\n");

    expect(sintetizadas).toEqual([]);
  });
});
