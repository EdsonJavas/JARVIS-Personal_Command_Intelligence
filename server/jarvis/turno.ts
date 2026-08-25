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

/** Última fala do dono: é sobre ela que a relevância é medida. */
function ultimaPerguntaDoDono(mensagens: FalaDaConversa[]): string {
  for (let i = mensagens.length - 1; i >= 0; i -= 1) {
    if (mensagens[i].role === "user") return mensagens[i].content;
  }
  return "";
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
      const selecionadas = selecionarMemorias(todas, ultimaPerguntaDoDono(mensagens));
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
