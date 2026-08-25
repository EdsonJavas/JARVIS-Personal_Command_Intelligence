/**
 * Orçamento de uma execução: quanto o Jarvis pode gastar num único pedido.
 *
 * Três dimensões independentes, porque uma sozinha não segura: doze rodadas
 * podem custar trinta e seis execuções de ferramenta, e vinte e quatro chamadas
 * rápidas gastam menos tempo do que uma varredura de disco.
 */

export type OrcamentoDeExecucao = {
  maxRodadas: number;
  maxChamadas: number;
  /** Teto de tempo ÚTIL, sem contar espera por resposta humana. */
  maxMs: number;
  avisoNaRodada: number;
};

export const ORCAMENTO_PADRAO: OrcamentoDeExecucao = {
  maxRodadas: 12,
  maxChamadas: 24,
  maxMs: 120_000,
  avisoNaRodada: 8,
};

export type EstadoDoOrcamento = {
  rodadas: number;
  chamadas: number;
  iniciadoEm: number;
  /** Tempo parado esperando o humano. NÃO conta contra maxMs. */
  esperandoHumanoMs: number;
};

export function iniciarOrcamento(): EstadoDoOrcamento {
  return { rodadas: 0, chamadas: 0, iniciadoEm: Date.now(), esperandoHumanoMs: 0 };
}

/**
 * Contabiliza uma rodada.
 *
 * Rodada `gratuita` é a que só serviu para perguntar. Perguntar precisa ser
 * barato: se consumisse orçamento, o modelo aprenderia a não perguntar, que é
 * o oposto do que se quer.
 */
export function registrarRodada(
  estado: EstadoDoOrcamento,
  chamadasNaRodada: number,
  gratuita = false
): EstadoDoOrcamento {
  return {
    ...estado,
    rodadas: estado.rodadas + (gratuita ? 0 : 1),
    chamadas: estado.chamadas + (gratuita ? 0 : chamadasNaRodada),
  };
}

export function creditarEspera(estado: EstadoDoOrcamento, ms: number): EstadoDoOrcamento {
  return { ...estado, esperandoHumanoMs: estado.esperandoHumanoMs + Math.max(0, ms) };
}

/** Tempo útil decorrido: relógio menos o que ficou parado esperando gente. */
export function tempoUtilMs(estado: EstadoDoOrcamento): number {
  return Math.max(0, Date.now() - estado.iniciadoEm - estado.esperandoHumanoMs);
}

export function orcamentoEstourado(
  estado: EstadoDoOrcamento,
  orcamento: OrcamentoDeExecucao = ORCAMENTO_PADRAO
): "orcamento" | null {
  if (estado.rodadas >= orcamento.maxRodadas) return "orcamento";
  if (estado.chamadas >= orcamento.maxChamadas) return "orcamento";
  if (tempoUtilMs(estado) >= orcamento.maxMs) return "orcamento";
  return null;
}

/** Quanto tempo ainda cabe. Vira o teto da próxima chamada de ferramenta. */
export function msRestantes(
  estado: EstadoDoOrcamento,
  orcamento: OrcamentoDeExecucao = ORCAMENTO_PADRAO
): number {
  return Math.max(0, orcamento.maxMs - tempoUtilMs(estado));
}

export function rodadasRestantes(
  estado: EstadoDoOrcamento,
  orcamento: OrcamentoDeExecucao = ORCAMENTO_PADRAO
): number {
  return Math.max(0, orcamento.maxRodadas - estado.rodadas);
}

/** A partir daqui vale avisar o modelo para priorizar o essencial. */
export function deveAvisar(
  estado: EstadoDoOrcamento,
  orcamento: OrcamentoDeExecucao = ORCAMENTO_PADRAO
): boolean {
  return estado.rodadas === orcamento.avisoNaRodada;
}
