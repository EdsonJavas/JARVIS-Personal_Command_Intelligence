import { randomUUID } from "node:crypto";
import type {
  EventoBrutoJarvis,
  EventoJarvis,
  EventoSemNumero,
  MensagemDeFio,
  MotivoCancelamento,
  PerguntaPendente,
} from "@shared/jarvisStream";
import { ehTerminal, GRACA_ORFA_MS, JANELA_RETOMADA_MS } from "@shared/jarvisStream";

/**
 * Registro das execuções em andamento.
 *
 * O laço roda desacoplado da conexão HTTP: os eventos são numerados e guardados
 * aqui, e quem estiver ouvindo recebe cópia. Isso é o que permite recarregar a
 * página no meio de uma tarefa e voltar a acompanhá-la do ponto onde parou, em
 * vez de perder o trabalho já feito.
 */

/** Identifica esta instância do processo. Muda a cada reinício. */
export const BOOT_ID = randomUUID();

const TETO_DE_EXECUCOES = 20;
const INTERVALO_DE_LIMPEZA_MS = 30_000;

export type Ouvinte = (evento: EventoJarvis) => void;

export type Execucao = {
  id: string;
  usuarioId: number;
  estado: "correndo" | "orfa" | "terminada";
  eventos: EventoJarvis[];
  ouvintes: Set<Ouvinte>;
  abort: AbortController;
  iniciadaEm: number;
  terminadaEm: number | null;
  temporizadorOrfa: NodeJS.Timeout | null;
  proximoSeq: number;
};

const execucoes = new Map<string, Execucao>();

/**
 * Ganchos preenchidos pelo módulo de perguntas, quando ele existir.
 *
 * Injetados em vez de importados para que este registro não dependa daquele
 * módulo — a dependência natural é a inversa, e um ciclo entre os dois travaria
 * o carregamento.
 */
export const ganchosDePergunta = {
  abortarDaExecucao: (_execucaoId: string, _motivo: string): number => 0,
  abertaDe: (_execucaoId: string): PerguntaPendente | null => null,
  encerrarTodas: (): void => {},
};

function agora() {
  return Date.now();
}

/** Numera, carimba e entrega o evento a quem estiver ouvindo. */
function publicar(execucao: Execucao, evento: EventoSemNumero): EventoJarvis {
  const completo = { ...evento, seq: execucao.proximoSeq++, em: agora() } as EventoJarvis;
  execucao.eventos.push(completo);

  if (ehTerminal(completo)) {
    execucao.estado = "terminada";
    execucao.terminadaEm = agora();
    if (execucao.temporizadorOrfa) {
      clearTimeout(execucao.temporizadorOrfa);
      execucao.temporizadorOrfa = null;
    }
  }

  for (const ouvinte of execucao.ouvintes) {
    try {
      ouvinte(completo);
    } catch {
      /* um ouvinte quebrado não pode derrubar os outros */
    }
  }

  return completo;
}

export function emitirBruto(execucaoId: string, evento: EventoBrutoJarvis): void {
  const execucao = execucoes.get(execucaoId);
  if (!execucao) return;
  publicar(execucao, evento as EventoSemNumero);
}

export function emitir(execucaoId: string, evento: EventoSemNumero): void {
  const execucao = execucoes.get(execucaoId);
  if (!execucao) return;
  publicar(execucao, evento);
}

/** Uma execução por usuário: a anterior é cancelada antes de abrir a nova. */
export function iniciarExecucao(entrada: {
  usuarioId: number;
  mensagens: MensagemDeFio[];
}): Execucao {
  for (const execucao of execucoes.values()) {
    if (execucao.usuarioId === entrada.usuarioId && execucao.estado !== "terminada") {
      cancelar(execucao.id, "nova_mensagem");
    }
  }

  const execucao: Execucao = {
    id: randomUUID(),
    usuarioId: entrada.usuarioId,
    estado: "correndo",
    eventos: [],
    ouvintes: new Set(),
    abort: new AbortController(),
    iniciadaEm: agora(),
    terminadaEm: null,
    temporizadorOrfa: null,
    proximoSeq: 1,
  };

  execucoes.set(execucao.id, execucao);
  despejarAntigas();
  return execucao;
}

export function obter(id: string, usuarioId: number): Execucao | null {
  const execucao = execucoes.get(id);
  if (!execucao) return null;
  if (execucao.usuarioId !== usuarioId) return null;
  return execucao;
}

/** A segunda janela não conhece o id: descobre pela sessão. */
export function execucaoAtivaDe(usuarioId: number): {
  execucaoId: string;
  pergunta: PerguntaPendente | null;
  iniciadaEm: number;
  /** A ferramenta que está rodando agora, se alguma. */
  ferramentaAtual: string | null;
} | null {
  for (const execucao of execucoes.values()) {
    if (execucao.usuarioId === usuarioId && execucao.estado !== "terminada") {
      return {
        execucaoId: execucao.id,
        pergunta: ganchosDePergunta.abertaDe(execucao.id),
        iniciadaEm: execucao.iniciadaEm,
        ferramentaAtual: ferramentaEmCurso(execucao.eventos),
      };
    }
  }
  return null;
}

/** O último `acao_inicio` sem `acao_fim` correspondente. */
function ferramentaEmCurso(eventos: EventoJarvis[]): string | null {
  const encerradas = new Set<string>();
  let atual: string | null = null;
  for (let i = eventos.length - 1; i >= 0; i -= 1) {
    const e = eventos[i];
    if (e.tipo === "acao_fim") encerradas.add(e.acaoId);
    else if (e.tipo === "acao_inicio" && !encerradas.has(e.acaoId)) {
      atual = e.ferramenta;
      break;
    }
  }
  return atual;
}

export type ResultadoAnexar =
  | { ok: true; execucao: Execucao; atrasados: EventoJarvis[] }
  | { ok: false; motivo: "desconhecida" | "de_outro_usuario" };

/**
 * Liga um ouvinte, reproduzindo primeiro o que ele perdeu.
 *
 * Reanexar cancela a carência de órfã: recarregar a página no meio de uma
 * tarefa não pode matá-la.
 */
export function anexar(
  id: string,
  desdeSeq: number,
  ouvinte: Ouvinte,
  usuarioId: number
): ResultadoAnexar {
  const execucao = execucoes.get(id);
  if (!execucao) return { ok: false, motivo: "desconhecida" };
  if (execucao.usuarioId !== usuarioId) return { ok: false, motivo: "de_outro_usuario" };

  if (execucao.temporizadorOrfa) {
    clearTimeout(execucao.temporizadorOrfa);
    execucao.temporizadorOrfa = null;
  }
  if (execucao.estado === "orfa") execucao.estado = "correndo";

  execucao.ouvintes.add(ouvinte);
  const atrasados = execucao.eventos.filter((evento) => evento.seq > desdeSeq);
  return { ok: true, execucao, atrasados };
}

/**
 * Desliga um ouvinte e, se não sobrou ninguém, abre a carência.
 *
 * A carência é chaveada por `ouvintes.size`, não por um booleano: uma reconexão
 * que chega antes do fechamento da conexão antiga não pode agendar o aborto da
 * execução que ela mesma acabou de reatar.
 *
 * Enquanto houver pergunta aberta, a carência acompanha o tempo restante dela —
 * um cartão de confirmação no ar é motivo legítimo para a página ficar parada,
 * e nada destrutivo roda nesse intervalo.
 */
export function desanexar(id: string, ouvinte: Ouvinte): void {
  const execucao = execucoes.get(id);
  if (!execucao) return;

  execucao.ouvintes.delete(ouvinte);
  if (execucao.ouvintes.size > 0) return;
  if (execucao.estado === "terminada") return;

  execucao.estado = "orfa";

  const pergunta = ganchosDePergunta.abertaDe(id);
  const restanteDaPergunta = pergunta ? Math.max(0, pergunta.expiraEm - agora()) : 0;
  const carencia = Math.max(GRACA_ORFA_MS, restanteDaPergunta);

  execucao.temporizadorOrfa = setTimeout(() => {
    if (execucao.ouvintes.size === 0 && execucao.estado === "orfa") {
      cancelar(id, "desconexao");
    }
  }, carencia);
  execucao.temporizadorOrfa.unref?.();
}

/**
 * Cancela uma execução.
 *
 * As perguntas abertas são fechadas ANTES do aborto: caso contrário a promessa
 * fica pendurada por minutos segurando a conversa inteira em memória, e alguns
 * cancelamentos seguidos esgotam o teto de perguntas simultâneas — deixando o
 * Jarvis incapaz de confirmar qualquer ação destrutiva.
 */
export function cancelar(id: string, motivo: MotivoCancelamento): boolean {
  const execucao = execucoes.get(id);
  if (!execucao) return false;
  if (execucao.estado === "terminada") return false;

  ganchosDePergunta.abortarDaExecucao(id, "nova_ordem");
  execucao.abort.abort();
  publicar(execucao, { tipo: "cancelado", motivo });
  return true;
}

export function cancelarTodasAsExecucoes(motivo: MotivoCancelamento): void {
  for (const id of [...execucoes.keys()]) cancelar(id, motivo);
  ganchosDePergunta.encerrarTodas();
}

/** Descarta o que já passou da janela de retomada e respeita o teto. */
function despejarAntigas(): void {
  const limite = agora() - JANELA_RETOMADA_MS;

  for (const [id, execucao] of execucoes) {
    if (execucao.estado === "terminada" && (execucao.terminadaEm ?? 0) < limite) {
      execucoes.delete(id);
    }
  }

  if (execucoes.size <= TETO_DE_EXECUCOES) return;

  const terminadas = [...execucoes.values()]
    .filter((execucao) => execucao.estado === "terminada")
    .sort((a, b) => (a.terminadaEm ?? 0) - (b.terminadaEm ?? 0));

  for (const execucao of terminadas) {
    if (execucoes.size <= TETO_DE_EXECUCOES) break;
    execucoes.delete(execucao.id);
  }
}

// Sem esta varredura, um processo que fica dias ligado acumula execuções
// terminadas para sempre.
const limpeza = setInterval(despejarAntigas, INTERVALO_DE_LIMPEZA_MS);
limpeza.unref?.();

/** Sinal de cancelamento da execução, para uso interno do servidor. */
export function sinalDe(execucaoId: string): AbortSignal {
  return execucoes.get(execucaoId)?.abort.signal ?? AbortSignal.abort();
}

/** Exposto para os testes. */
export function _zerarRegistro(): void {
  for (const execucao of execucoes.values()) {
    if (execucao.temporizadorOrfa) clearTimeout(execucao.temporizadorOrfa);
  }
  execucoes.clear();
}

export function _tamanhoDoRegistro(): number {
  return execucoes.size;
}
