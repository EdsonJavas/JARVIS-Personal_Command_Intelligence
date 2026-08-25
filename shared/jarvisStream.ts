/**
 * Contrato do fio entre o laço do Jarvis e a interface.
 *
 * Esta é a ÚNICA união de eventos do projeto. Cliente e servidor importam daqui
 * via `@shared`, então divergência de formato vira erro de compilação em vez de
 * quadro ignorado em tempo de execução.
 */

export const CAMINHO_STREAM = "/api/jarvis/stream";
export const CAMINHO_EXECUCAO = "/api/jarvis/execucao";

export const INTERVALO_KEEPALIVE_MS = 15_000;
export const JANELA_RETOMADA_MS = 60_000;
export const GRACA_ORFA_MS = 15_000;
export const MAX_NARRACAO_CHARS = 180;
export const JANELA_DE_HISTORICO = 16;

export type OrigemNarracao = "modelo" | "sistema";
export type MotivoCancelamento =
  | "usuario"
  | "nova_mensagem"
  | "desconexao"
  | "desligamento";
export type MotivoDeParada = "concluido" | "orcamento" | "falhas" | "cancelado";

export type CodigoErroStream =
  | "missing_key"
  | "quota_exceeded"
  | "provider_failure"
  | "invalid_reply"
  | "nao_autenticado"
  | "execucao_desconhecida"
  | "interno";

/** O que o Jarvis executou. `resumo` é o fato apurado, curto. */
export type AcaoJarvis = {
  name: string;
  detail: string;
  ok: boolean;
  resumo: string;
};

/* ------------------------- pergunta interativa --------------------------- */

export type NivelDeRisco = "normal" | "destrutivo" | "critico";
export type TipoDePergunta = "escolha" | "texto" | "confirmacao";

export type OpcaoDePergunta = {
  id: string;
  rotulo: string;
  detalhe?: string;
  perigo?: boolean;
};

export type PerguntaPendente = {
  id: string;
  bootId: string;
  execucaoId: string;
  tipo: TipoDePergunta;
  /** Falado em voz alta. */
  pergunta: string;
  opcoes: OpcaoDePergunta[];
  aceitaTextoLivre: boolean;
  nivel: NivelDeRisco;
  /** Mostrado na tela, nunca falado. */
  impacto?: string;
  /** Bloco técnico, nunca falado. */
  detalheTecnico?: string;
  ferramenta?: string;
  criadaEm: number;
  expiraEm: number;
};

export type DesfechoPergunta = "respondida" | "expirada" | "cancelada" | "abortada";

/* --------------- eventos brutos: o que o LAÇO emite ---------------------- */

export type EventoBrutoJarvis =
  | { tipo: "pensando"; rodada: number }
  /**
   * Pedaço da resposta final, conforme o modelo escreve.
   *
   * Vale a pena só em resposta longa: medido, o provedor entrega uma resposta
   * curta praticamente de uma vez (50ms de ganho), e uma longa em 76% do tempo
   * (3,4s de ganho). Resumo e explicacao sao justamente as longas.
   */
  | { tipo: "resposta_parcial"; texto: string }
  | { tipo: "narracao"; texto: string; origem: OrigemNarracao; rodada: number }
  | {
      tipo: "acao_inicio";
      acaoId: string;
      ferramenta: string;
      detalhe: string;
      rodada: number;
    }
  | {
      tipo: "acao_fim";
      acaoId: string;
      ferramenta: string;
      detalhe: string;
      ok: boolean;
      bloqueada: boolean;
      duracaoMs: number;
      resumo: string;
    }
  | { tipo: "pergunta"; pergunta: PerguntaPendente }
  | { tipo: "pergunta_resolvida"; perguntaId: string; desfecho: DesfechoPergunta };

/* -------------- eventos de fio: o REGISTRO numera e carimba --------------- */

export type EventoJarvis =
  | ({ seq: number; em: number } & EventoBrutoJarvis)
  | {
      tipo: "inicio";
      seq: number;
      em: number;
      execucaoId: string;
      modelo: string;
      bootId: string;
    }
  | {
      tipo: "resposta";
      seq: number;
      em: number;
      /** Íntegro, para a bolha da conversa. */
      texto: string;
      /** Enxugado, para a síntese de voz. */
      fala: string;
      modelo: string;
      motivoDeParada: MotivoDeParada;
      acoes: AcaoJarvis[];
    }
  | {
      tipo: "erro";
      seq: number;
      em: number;
      codigo: CodigoErroStream;
      mensagem: string;
      recuperavel: boolean;
    }
  | { tipo: "cancelado"; seq: number; em: number; motivo: MotivoCancelamento };

export type TipoEvento = EventoJarvis["tipo"];

/**
 * Omit sobre união colapsa para as chaves comuns a todos os membros, o que aqui
 * apagaria quase tudo. Este condicional distribui o Omit membro a membro.
 */
type OmitDistributivo<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Evento como o laço o produz, antes do registro numerar e carimbar. */
export type EventoSemNumero = OmitDistributivo<EventoJarvis, "seq" | "em">;

export const EVENTOS_TERMINAIS = ["resposta", "erro", "cancelado"] as const;

export function ehTerminal(evento: EventoJarvis): boolean {
  return (EVENTOS_TERMINAIS as readonly string[]).includes(evento.tipo);
}

/**
 * Corpo do POST. `mensagens` carrega `acoes` de propósito: é assim que o que o
 * Jarvis já executou volta para o modelo no turno seguinte, em vez de ele
 * refazer a medição que acabou de fazer.
 */
export type MensagemDeFio = {
  role: "user" | "assistant";
  content: string;
  acoes?: AcaoJarvis[];
};

export type PedidoStream =
  | { modo: "novo"; mensagens: MensagemDeFio[] }
  | { modo: "retomar"; execucaoId: string; desdeSeq: number };

/*
 * FORMATO DO FIO (SSE):
 *   id: <seq>\n
 *   event: <tipo>\n
 *   data: <JSON.stringify(evento)>\n\n
 *
 * Uma única linha `data:` por quadro. O keep-alive é `: ping\n\n`, que por ser
 * comentário não consome número de sequência e não confunde a retomada.
 * Encerramento limpo: `event: fim\ndata: {}\n\n` seguido de res.end().
 * Sem superjson — o contrato é JSON puro dos dois lados.
 */

/* ------------------------------------------------------------------ *
 * Iniciativas: quando o Jarvis fala primeiro
 * ------------------------------------------------------------------ */

/**
 * Um compromisso venceu e ele está procurando o dono.
 *
 * Viaja num fluxo PRÓPRIO, separado do de execução: uma iniciativa acontece
 * fora de qualquer conversa, e amarrá-la a uma execução significaria que só
 * chegaria enquanto o dono já estivesse falando com ele — que é justamente
 * quando ela menos importa.
 */
export type IniciativaJarvis = {
  compromissoId: number;
  tipo: "lembrete" | "rotina" | "vigia";
  texto: string;
  em: number;
  /** Só nos vigias: o valor medido que provocou o aviso. */
  valor?: number;
};

export const CAMINHO_INICIATIVAS = "/api/jarvis/iniciativas";
