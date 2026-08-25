import { describe, expect, it, vi, afterEach } from "vitest";
import {
  creditarEspera,
  deveAvisar,
  iniciarOrcamento,
  msRestantes,
  orcamentoEstourado,
  registrarRodada,
  ORCAMENTO_PADRAO,
} from "./orcamento";

afterEach(() => {
  vi.useRealTimers();
});

describe("orçamento de execução", () => {
  it("uma rodada com três chamadas soma uma rodada e três chamadas", () => {
    // Rodada e chamada são coisas diferentes: doze rodadas podiam custar trinta
    // e seis execuções de ferramenta sem que nada acusasse.
    const estado = registrarRodada(iniciarOrcamento(), 3);
    expect(estado.rodadas).toBe(1);
    expect(estado.chamadas).toBe(3);
  });

  it("estoura por rodadas, por chamadas e por tempo, cada um sozinho", () => {
    let porRodadas = iniciarOrcamento();
    for (let i = 0; i < ORCAMENTO_PADRAO.maxRodadas; i += 1) {
      porRodadas = registrarRodada(porRodadas, 1);
    }
    expect(orcamentoEstourado(porRodadas)).toBe("orcamento");

    const porChamadas = registrarRodada(iniciarOrcamento(), ORCAMENTO_PADRAO.maxChamadas);
    expect(orcamentoEstourado(porChamadas)).toBe("orcamento");

    const porTempo = { ...iniciarOrcamento(), iniciadoEm: Date.now() - ORCAMENTO_PADRAO.maxMs - 1 };
    expect(orcamentoEstourado(porTempo)).toBe("orcamento");
  });

  it("espera humana creditada NÃO estoura o teto de tempo", () => {
    // Uma confirmação de noventa segundos não pode encerrar a tarefa no
    // instante exato em que o dono clica "sim".
    const parado = ORCAMENTO_PADRAO.maxMs + 30_000;
    const estado = creditarEspera(
      { ...iniciarOrcamento(), iniciadoEm: Date.now() - parado },
      parado
    );
    expect(orcamentoEstourado(estado)).toBeNull();
  });

  it("rodada gratuita não consome rodadas nem chamadas", () => {
    // Perguntar precisa ser barato, senão o modelo aprende a não perguntar.
    const estado = registrarRodada(iniciarOrcamento(), 1, true);
    expect(estado.rodadas).toBe(0);
    expect(estado.chamadas).toBe(0);
  });

  it("o tempo restante limita o prazo da próxima ferramenta", () => {
    const estado = { ...iniciarOrcamento(), iniciadoEm: Date.now() - (ORCAMENTO_PADRAO.maxMs - 5_000) };
    const restante = msRestantes(estado);
    // Uma medição de disco de sessenta segundos não pode furar um orçamento
    // que só tem cinco.
    expect(restante).toBeLessThanOrEqual(5_000);
    expect(restante).toBeGreaterThan(0);
  });

  it("avisa exatamente na rodada configurada", () => {
    const antes = { ...iniciarOrcamento(), rodadas: ORCAMENTO_PADRAO.avisoNaRodada - 1 };
    const dentro = { ...iniciarOrcamento(), rodadas: ORCAMENTO_PADRAO.avisoNaRodada };
    expect(deveAvisar(antes)).toBe(false);
    expect(deveAvisar(dentro)).toBe(true);
  });
});
