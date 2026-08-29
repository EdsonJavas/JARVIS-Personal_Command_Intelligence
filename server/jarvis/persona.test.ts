import { describe, expect, it } from "vitest";
import { construirInstrucaoDeSistema, notaDeFechamento, notaDeOrcamento } from "./persona";

/**
 * Teste de CONTRATO do prompt.
 *
 * O prompt é código: mudá-lo muda o comportamento do assistente inteiro, e não
 * há compilador que pegue uma contradição. Este arquivo existe porque o defeito
 * mais caro que o projeto teve foi exatamente isso — a regra "fale de 1 a 4
 * frases", escrita para a VOZ, valendo também para o texto na tela e deixando
 * o assistente proibido de dar uma resposta boa por escrito.
 *
 * Não verifica redação. Verifica que as duas partes continuam separadas e que
 * nenhuma nota reimpõe à resposta escrita o limite que é só da falada.
 */

const prompt = () =>
  construirInstrucaoDeSistema({
    dono: "Edson",
    agora: new Date("2026-08-26T10:41:00-03:00"),
    relatorioDaMaquina: "",
    memoria: "",
  });

describe("contrato das duas partes", () => {
  it("pede as duas partes e nomeia o separador", () => {
    const p = prompt();
    expect(p).toContain("DUAS PARTES");
    expect(p).toContain("LINHA EM BRANCO");
    expect(p).toContain("A parte falada");
    expect(p).toContain("A parte escrita");
  });

  it("o painel continua obrigatório — foi ordem explícita do dono", () => {
    expect(prompt()).toContain("mostrar_no_painel");
    expect(prompt()).toMatch(/painel continua obrigat[óo]rio/i);
  });

  it("a regra de 1 a 4 frases pertence à FALA, não ao texto", () => {
    const p = prompt();
    const trecho = p.slice(p.indexOf("### A parte falada"), p.indexOf("### A parte escrita"));
    expect(trecho).toContain("1 a 4 frases");
    // Depois da fronteira, a regra é o oposto.
    expect(p.slice(p.indexOf("### A parte escrita"))).toMatch(/o OPOSTO|markdown/i);
  });

  it("nenhuma reimposição do limite antigo sobrevive", () => {
    const p = prompt();
    expect(p).not.toContain("Sua resposta é FALADA em voz alta");
    expect(p).not.toContain("Três frases, no máximo");
  });

  it("as notas de fechamento pedem as duas partes, não duas frases", () => {
    for (const motivo of ["orcamento", "falhas", "concluido"] as const) {
      const nota = notaDeFechamento(motivo);
      expect(nota).toContain("duas partes");
      expect(nota).toContain("linha em branco");
      // O que existia antes: "Responda agora, em 2 a 4 frases faladas."
      expect(nota).not.toMatch(/^Pare de usar ferramentas\. Responda agora, em 2 a 4 frases/);
    }
  });

  it("a nota de orçamento encurta a execução, e diz que não encurta a resposta", () => {
    const nota = notaDeOrcamento(3);
    expect(nota).toContain("EXECUÇÃO");
    expect(nota).toMatch(/n[ãa]o a RESPOSTA/i);
  });
});
