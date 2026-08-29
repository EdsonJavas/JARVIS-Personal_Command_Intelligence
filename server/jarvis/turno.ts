import { collectSystemStats, describeSystemForModel } from "../systemStats";
import { describeBoardForModel } from "../board";
import { listarMemorias, registrarUso } from "../memoria/repositorio";
import { montarBlocoDeMemoria, selecionarMemorias } from "../memoria/relevancia";

/**
 * Preparo e encerramento de um turno.
 *
 * Existe para que os dois caminhos — o fluxo com narração e a rota simples —
 * montem o contexto do mesmo jeito. Escrito dentro do roteador, o Jarvis teria
 * memória apenas em um deles.
 */

export type TurnoPreparado = {
  relatorioDaMaquina: string;
  memorias: string;
  /** Ids usados, para registrar proveito depois da resposta. */
  usadas: number[];
};

/**
 * O preparo só precisa de papel e conteúdo. Tipar pelo mínimo deixa os dois
 * caminhos — o fluxo e a rota simples — chamarem sem conversão.
 */
type FalaDaConversa = { role: "user" | "assistant"; content: string };

/**
 * A consulta de memória são as últimas falas do dono, não só a derradeira.
 *
 * "E o outro?" ou "e amanhã?" não têm token útil nenhum: medida contra elas, a
 * relevância dá zero e o bloco de memória volta vazio justamente no momento em
 * que o contexto mais importa. As falas anteriores carregam o assunto.
 */
const FALAS_QUE_CONTAM = 3;

function consultaDeMemoria(mensagens: FalaDaConversa[]): string {
  return mensagens
    .filter((m) => m.role === "user")
    .slice(-FALAS_QUE_CONTAM)
    .map((m) => m.content)
    .join(" ");
}

export async function prepararTurno(mensagens: FalaDaConversa[]): Promise<TurnoPreparado> {
  const relatorio = [describeSystemForModel(collectSystemStats()), describeBoardForModel()]
    .filter(Boolean)
    .join("\n");

  let memorias = "";
  let usadas: number[] = [];

  try {
    const todas = await listarMemorias();
    if (todas.length > 0) {
      const selecionadas = selecionarMemorias(todas, consultaDeMemoria(mensagens));
      memorias = montarBlocoDeMemoria(selecionadas);
      usadas = selecionadas.map((item) => item.memoria.id);
    }
  } catch (erro) {
    // Memória indisponível não pode impedir o Jarvis de responder.
    console.warn("[Turno] memória indisponível:", String(erro).slice(0, 140));
  }

  return { relatorioDaMaquina: relatorio, memorias, usadas };
}

/**
 * Fecha o turno. Nunca lança e nunca é aguardado pelo caminho da resposta: uma
 * falha aqui não pode atrasar nem derrubar o que o dono já recebeu.
 */
export function concluirTurno(entrada: { usadas: number[] }): void {
  if (entrada.usadas.length === 0) return;
  void registrarUso(entrada.usadas).catch((erro) => {
    console.warn("[Turno] falha ao registrar uso de memória:", String(erro).slice(0, 140));
  });
}
