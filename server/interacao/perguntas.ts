import { randomUUID } from "node:crypto";
import type {
  DesfechoPergunta,
  EventoBrutoJarvis,
  NivelDeRisco,
  OpcaoDePergunta,
  PerguntaPendente,
  TipoDePergunta,
} from "@shared/jarvisStream";
import { BOOT_ID, ganchosDePergunta } from "../execucoes";

/**
 * Perguntas que travam o laço esperando o dono responder.
 *
 * Este módulo é a trava real das ações destrutivas: enquanto a promessa não
 * resolve, o `execute` da ferramenta não roda. E ele falha para o lado seguro —
 * silêncio, expiração, cancelamento e desligamento resolvem como RECUSA, nunca
 * como autorização.
 */

export const TEMPO_PADRAO_MS = 180_000;
export const TEMPO_CONFIRMACAO_MS = 90_000;
export const MAX_PERGUNTAS_ABERTAS = 8;
export const MAX_PERGUNTAS_POR_EXECUCAO = 4;

/** Omit sobre união colapsa para as chaves comuns; este distribui membro a membro. */
type SemEspera<T> = T extends unknown ? Omit<T, "esperouMs"> : never;

export type ResultadoDePergunta =
  | { desfecho: "respondida"; texto: string; opcaoId?: string; esperouMs: number }
  | { desfecho: "expirada"; esperouMs: number }
  | { desfecho: "cancelada"; texto?: string; esperouMs: number }
  | { desfecho: "abortada"; motivo: string; esperouMs: number };

export type RespostaDePergunta = {
  perguntaId: string;
  /** Clique numa opção. */
  opcaoId?: string;
  /** Texto livre, digitado ou ditado. */
  texto?: string;
  /** De onde veio a resposta. Voz nunca autoriza confirmação. */
  origem: "clique" | "voz" | "texto";
  cancelar?: boolean;
};

type Registro = {
  pergunta: PerguntaPendente;
  resolver: (resultado: ResultadoDePergunta) => void;
  temporizador: NodeJS.Timeout;
  criadaEm: number;
  emitir: (evento: EventoBrutoJarvis) => void;
  ouvinteDeAborto?: () => void;
  sinal?: AbortSignal;
};

const abertas = new Map<string, Registro>();
const porExecucao = new Map<string, number>();

function encerrar(
  id: string,
  resultado: SemEspera<ResultadoDePergunta>,
  desfecho: DesfechoPergunta
): void {
  const registro = abertas.get(id);
  if (!registro) return;

  clearTimeout(registro.temporizador);
  if (registro.sinal && registro.ouvinteDeAborto) {
    registro.sinal.removeEventListener("abort", registro.ouvinteDeAborto);
  }
  abertas.delete(id);

  registro.emitir({ tipo: "pergunta_resolvida", perguntaId: id, desfecho });
  registro.resolver({
    ...resultado,
    esperouMs: Date.now() - registro.criadaEm,
  } as ResultadoDePergunta);
}

export type ParametrosDePergunta = {
  execucaoId: string;
  tipo: TipoDePergunta;
  pergunta: string;
  opcoes?: OpcaoDePergunta[];
  aceitaTextoLivre?: boolean;
  nivel?: NivelDeRisco;
  impacto?: string;
  detalheTecnico?: string;
  ferramenta?: string;
  timeoutMs?: number;
  emitir: (evento: EventoBrutoJarvis) => void;
  sinal: AbortSignal;
  interativo: boolean;
};

/**
 * Abre uma pergunta e espera.
 *
 * NUNCA rejeita: todo desfecho, inclusive erro de uso, volta como valor. Uma
 * rejeição aqui viraria exceção dentro da ferramenta, e o laço trataria como
 * falha técnica — levando o modelo a "tentar outro caminho" para fazer
 * exatamente o que o dono acabou de recusar.
 */
export function abrirPergunta(params: ParametrosDePergunta): Promise<ResultadoDePergunta> {
  const agora = Date.now();

  // Sem canal para perguntar, responde na hora. Esperar aqui penduraria a
  // chamada por minutos e voltaria dizendo que nada foi feito, sem que o dono
  // tivesse visto pergunta nenhuma.
  if (!params.interativo) {
    return Promise.resolve({
      desfecho: "cancelada",
      texto:
        "Não há canal para confirmar agora; peça a confirmação na sua resposta em texto e não execute.",
      esperouMs: 0,
    });
  }

  if (params.sinal.aborted) {
    return Promise.resolve({ desfecho: "abortada", motivo: "ja_cancelada", esperouMs: 0 });
  }

  if (abertas.size >= MAX_PERGUNTAS_ABERTAS) {
    return Promise.resolve({
      desfecho: "cancelada",
      texto: "Há perguntas demais abertas no momento; decida sozinho ou pare e relate.",
      esperouMs: 0,
    });
  }

  const feitas = porExecucao.get(params.execucaoId) ?? 0;
  if (feitas >= MAX_PERGUNTAS_POR_EXECUCAO) {
    return Promise.resolve({
      desfecho: "cancelada",
      texto:
        "Você já perguntou demais nesta tarefa. Decida com o que tem ou pare e relate ao Senhor.",
      esperouMs: 0,
    });
  }

  const texto = String(params.pergunta ?? "").trim();
  if (!texto) {
    return Promise.resolve({
      desfecho: "cancelada",
      texto: "A pergunta veio vazia; reformule.",
      esperouMs: 0,
    });
  }

  const opcoes = (params.opcoes ?? []).slice(0, 8).filter((opcao) => opcao?.id && opcao?.rotulo);
  // Ids repetidos tornariam a resposta ambígua.
  const vistos = new Set<string>();
  const opcoesUnicas = opcoes.filter((opcao) => {
    if (vistos.has(opcao.id)) return false;
    vistos.add(opcao.id);
    return true;
  });

  const timeoutMs =
    params.timeoutMs ??
    (params.tipo === "confirmacao" ? TEMPO_CONFIRMACAO_MS : TEMPO_PADRAO_MS);

  const pergunta: PerguntaPendente = {
    id: randomUUID(),
    bootId: BOOT_ID,
    execucaoId: params.execucaoId,
    tipo: params.tipo,
    pergunta: texto,
    opcoes: opcoesUnicas,
    aceitaTextoLivre: params.aceitaTextoLivre ?? params.tipo !== "confirmacao",
    nivel: params.nivel ?? "normal",
    impacto: params.impacto,
    detalheTecnico: params.detalheTecnico,
    ferramenta: params.ferramenta,
    criadaEm: agora,
    expiraEm: agora + timeoutMs,
  };

  porExecucao.set(params.execucaoId, feitas + 1);

  return new Promise<ResultadoDePergunta>((resolve) => {
    const temporizador = setTimeout(() => {
      // Silêncio NUNCA é sim.
      encerrar(pergunta.id, { desfecho: "expirada" }, "expirada");
    }, timeoutMs);
    temporizador.unref?.();

    const ouvinteDeAborto = () => {
      encerrar(pergunta.id, { desfecho: "abortada", motivo: "execucao_cancelada" }, "abortada");
    };
    params.sinal.addEventListener("abort", ouvinteDeAborto, { once: true });

    abertas.set(pergunta.id, {
      pergunta,
      resolver: resolve,
      temporizador,
      criadaEm: agora,
      emitir: params.emitir,
      ouvinteDeAborto,
      sinal: params.sinal,
    });

    // O evento sai ANTES de bloquear: se saísse depois, a interface só saberia
    // da pergunta quando ela já tivesse expirado.
    params.emitir({ tipo: "pergunta", pergunta });
  });
}

/** Palavras que autorizam. Qualquer coisa fora desta lista é recusa. */
const AFIRMACOES = [
  "sim",
  "pode",
  "pode sim",
  "confirmo",
  "confirma",
  "confirmado",
  "isso mesmo",
  "isso",
  "ok",
  "certo",
  "manda",
  "vai",
  "prossiga",
  "autorizo",
];

const NEGACOES = ["nao", "não", "cancela", "cancelar", "para", "pare", "deixa", "esquece"];

function normalizar(texto: string): string {
  return String(texto ?? "")
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Autorização explícita.
 *
 * Lista branca em vez de "não contém não": erro de transcrição precisa cair
 * para RECUSA, não para autorização. "Sei não" e "acho que não" não autorizam.
 */
export function ehAfirmacaoExplicita(texto: string): boolean {
  const limpo = normalizar(texto);
  if (!limpo) return false;
  if (NEGACOES.some((negacao) => limpo === normalizar(negacao))) return false;
  if (/\bnao\b/.test(limpo)) return false;
  return AFIRMACOES.includes(limpo);
}

export function ehCancelamentoExplicito(texto: string): boolean {
  const limpo = normalizar(texto);
  return ["cancela", "cancelar", "esquece isso", "esquece", "deixa pra la", "para", "pare"].includes(
    limpo
  );
}

export function responderPergunta(
  resposta: RespostaDePergunta
): { aceita: true } | { aceita: false; motivo: "desconhecida" | "ja_respondida" | "voz_nao_autoriza" } {
  const registro = abertas.get(resposta.perguntaId);
  if (!registro) return { aceita: false, motivo: "desconhecida" };

  const { pergunta } = registro;

  if (resposta.cancelar || (resposta.texto && ehCancelamentoExplicito(resposta.texto))) {
    encerrar(pergunta.id, { desfecho: "cancelada", texto: resposta.texto }, "cancelada");
    return { aceita: true };
  }

  if (resposta.opcaoId) {
    const opcao = pergunta.opcoes.find((item) => item.id === resposta.opcaoId);
    if (!opcao) return { aceita: false, motivo: "desconhecida" };
    encerrar(
      pergunta.id,
      {
        desfecho: "respondida",
        texto: opcao.detalhe ? `${opcao.rotulo} — ${opcao.detalhe}` : opcao.rotulo,
        opcaoId: opcao.id,
      },
      "respondida"
    );
    return { aceita: true };
  }

  const texto = String(resposta.texto ?? "").trim();
  if (!texto) return { aceita: false, motivo: "desconhecida" };

  /**
   * A DECISÃO MAIS IMPORTANTE DESTE MÓDULO.
   *
   * Numa máquina com microfone e alto-falante embutidos, sem cancelamento de
   * eco no caminho da API de reconhecimento, o Jarvis fala "isso encerra o
   * Chrome, confirma?" e o próprio reconhecedor transcreve a fala dele. A
   * palavra "confirma" apareceria na transcrição e autorizaria a ação sozinha.
   *
   * Em confirmação, portanto, voz nunca autoriza: só clique. Voz ainda pode
   * RECUSAR, porque recusar por engano é seguro.
   */
  if (pergunta.tipo === "confirmacao" && resposta.origem === "voz") {
    return { aceita: false, motivo: "voz_nao_autoriza" };
  }

  if (pergunta.tipo === "confirmacao" && !ehAfirmacaoExplicita(texto)) {
    encerrar(pergunta.id, { desfecho: "cancelada", texto }, "cancelada");
    return { aceita: true };
  }

  encerrar(pergunta.id, { desfecho: "respondida", texto }, "respondida");
  return { aceita: true };
}

export function perguntaAbertaDe(execucaoId: string): PerguntaPendente | null {
  for (const registro of abertas.values()) {
    if (registro.pergunta.execucaoId === execucaoId) return registro.pergunta;
  }
  return null;
}

export function prorrogarPergunta(id: string, ms = 60_000): boolean {
  const registro = abertas.get(id);
  if (!registro) return false;

  clearTimeout(registro.temporizador);
  registro.pergunta.expiraEm = Date.now() + ms;
  registro.temporizador = setTimeout(() => {
    encerrar(id, { desfecho: "expirada" }, "expirada");
  }, ms);
  registro.temporizador.unref?.();
  return true;
}

export function abortarPerguntasDaExecucao(execucaoId: string, motivo: string): number {
  let fechadas = 0;
  for (const [id, registro] of [...abertas]) {
    if (registro.pergunta.execucaoId !== execucaoId) continue;
    encerrar(id, { desfecho: "abortada", motivo }, "abortada");
    fechadas += 1;
  }
  porExecucao.delete(execucaoId);
  return fechadas;
}

export function encerrarTodasAsPerguntas(): void {
  for (const id of [...abertas.keys()]) {
    encerrar(id, { desfecho: "abortada", motivo: "desligamento" }, "abortada");
  }
  porExecucao.clear();
}

/** Exposto para os testes. */
export function _abertas(): number {
  return abertas.size;
}

export function _zerar(): void {
  for (const registro of abertas.values()) clearTimeout(registro.temporizador);
  abertas.clear();
  porExecucao.clear();
}

// O registro de execuções cancela perguntas ao abortar, mas não pode importar
// este módulo sem criar ciclo. Os ganchos são preenchidos aqui, no sentido
// natural da dependência.
ganchosDePergunta.abertaDe = perguntaAbertaDe;
ganchosDePergunta.abortarDaExecucao = abortarPerguntasDaExecucao;
ganchosDePergunta.encerrarTodas = encerrarTodasAsPerguntas;
