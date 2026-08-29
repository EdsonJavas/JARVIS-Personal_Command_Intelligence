import { z } from "zod";
import { randomUUID } from "node:crypto";
import type {
  AcaoJarvis,
  EventoBrutoJarvis,
  MensagemDeFio,
  MotivoDeParada,
} from "@shared/jarvisStream";
import { JANELA_DE_HISTORICO } from "@shared/jarvisStream";
import {
  invokeTool,
  narrarChamada,
  nomesDasFerramentas,
  toolSchemas,
  type ContextoDeExecucao,
  type ToolOutcome,
} from "./tools/registry";
import {
  construirInstrucaoDeSistema,
  notaDeFechamento,
  notaDeOrcamento,
} from "./jarvis/persona";
import {
  creditarEspera,
  deveAvisar,
  iniciarOrcamento,
  msRestantes,
  orcamentoEstourado,
  registrarRodada,
  rodadasRestantes,
  ORCAMENTO_PADRAO,
  type EstadoDoOrcamento,
  type OrcamentoDeExecucao,
} from "./jarvis/orcamento";
import {
  assinaturaDaChamada,
  avaliarTentativa,
  deveDesistir,
  type RegistroDeTentativa,
} from "./jarvis/falhas";
import { falaDaResposta } from "./jarvis/fala";
import { desmarcar, marcarEsgotado, modeloAtual, proximoModelo } from "./jarvis/modelos";
import { classificarRecusa } from "./jarvis/recusa";
import { registrarAcao } from "./acoes/repositorio";
import { resumirSelecao, selecionarFerramentas } from "./jarvis/selecaoDeFerramentas";
import { aplicarDelta, lerQuadros, montarMensagem, novoEstado } from "./jarvis/fluxoProvedor";
import { comRecapitulacao, resumirSaida } from "./jarvis/recapitulacao";

const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";

/**
 * Quanto de saída CRUA de ferramenta cabe no contexto antes de encolher.
 *
 * Em caracteres, não em rodadas: contar rodadas jogava fora medição de graça
 * num turno pequeno. Com janela de um milhão de tokens, 24 KB é irrisório, e
 * na maioria dos turnos nada é podado.
 */
const TETO_DE_SAIDAS_CRUAS = 24_000;
/** Primeiro corte: ainda carrega os números medidos. */
const RESUMO_LARGO = 1200;
/** Segundo corte, só para o que continuar estourando: a linha de sempre. */
const RESUMO_CURTO = 0;
/** Quanto de original volta antes da chamada que escreve a resposta. */
const TETO_NO_FECHAMENTO = 60_000;
/** Quantos turnos atrás ainda mantêm um grupo externo disponível. */
const TURNOS_QUE_LEMBRAM_O_GRUPO = 3;

/**
 * Tetos de saída, por fase do turno.
 *
 * A rodada que escolhe ferramenta emite uma chamada e uma frase de narração —
 * cabe folgada. A que ESCREVE a resposta é a que o dono lê, e é onde o teto
 * apertado aparecia como resposta truncada ou vazia.
 */
const TETO_FERRAMENTA = 2048;
const TETO_RESPOSTA = 8192;

export const acaoSchema = z.object({
  name: z.string(),
  detail: z.string(),
  ok: z.boolean(),
  resumo: z.string().max(200).optional(),
});

export const jarvisMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(6000),
  acoes: z.array(acaoSchema).max(12).optional(),
});

export type JarvisChatMessage = z.infer<typeof jarvisMessageSchema>;

export class JarvisProviderError extends Error {
  constructor(
    public readonly kind:
      | "missing_key"
      | "quota_exceeded"
      | "provider_failure"
      | "invalid_reply",
    message: string,
    /**
     * Quando o provedor disse quanto esperar. Vai até o botão de reenviar, que
     * conta o tempo em vez de deixar o dono chutar.
     */
    public readonly esperaMs?: number
  ) {
    super(message);
    this.name = "JarvisProviderError";
  }
}

export type OpcoesJarvis = {
  relatorioDaMaquina?: string;
  /** Bloco pronto de memória. Só entra na PRIMEIRA rodada. */
  memorias?: string;
  aoEvento?: (evento: EventoBrutoJarvis) => void;
  sinal?: AbortSignal;
  execucaoId?: string;
  /** Falso quando não há canal para perguntar (caminho sem stream). */
  interativo?: boolean;
  orcamento?: Partial<OrcamentoDeExecucao>;
};

export type RespostaDoJarvis = {
  reply: string;
  fala: string;
  model: string;
  actions: AcaoJarvis[];
  motivoDeParada: MotivoDeParada;
};

function resolveChatEndpoint(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.endsWith("/chat/completions")
    ? normalized
    : `${normalized}/chat/completions`;
}

function getGeminiConfiguration() {
  const apiKey = process.env.LLM_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new JarvisProviderError(
      "missing_key",
      "A chave de IA ainda não foi configurada no projeto."
    );
  }

  return {
    apiKey,
    endpoint: resolveChatEndpoint(process.env.LLM_BASE_URL?.trim() || DEFAULT_GEMINI_BASE_URL),
    // O modelo sai do rodízio, e não fixo: a cota gratuita é POR MODELO, e
    // trocar ao esgotar é o que mantém o Jarvis de pé o dia inteiro.
    model: modeloAtual(),
  };
}

/** Espera que o cancelamento interrompe: o dono não fica preso num timer. */
function dormir(ms: number, sinal?: AbortSignal): Promise<void> {
  return new Promise((resolver) => {
    if (sinal?.aborted) return resolver();
    const aoAbortar = () => {
      clearTimeout(timer);
      resolver();
    };
    const timer = setTimeout(() => {
      sinal?.removeEventListener("abort", aoAbortar);
      resolver();
    }, ms);
    sinal?.addEventListener("abort", aoAbortar, { once: true });
  });
}

function describeProviderFailure(status: number) {
  if (status === 401 || status === 403) {
    return "A chave de IA foi recusada pelo provedor. Revise a credencial configurada.";
  }
  if (status === 404) {
    return "O modelo configurado não está disponível para esta chave. Revise o modelo do provedor.";
  }
  if (status === 429) {
    return "O limite de uso do provedor foi atingido. Aguarde a renovação da cota e tente novamente.";
  }
  if (status >= 500) {
    return "O provedor de IA está indisponível no momento. Tente novamente em instantes.";
  }
  return "O provedor de IA não conseguiu processar esta solicitação.";
}

type ProviderMessage = {
  role: string;
  content?: string | null;
  tool_calls?: {
    id: string;
    type: string;
    function: { name: string; arguments: string };
    /** Opaco: a `thought_signature` do Gemini 3 volta por aqui, intacta. */
    extra_content?: unknown;
  }[];
  tool_call_id?: string;
  /** Marca interna: identifica saídas de ferramenta que a poda pode encolher. */
  _podavel?: { rodada: number; resumo: string; original: string; ok: boolean; ferramenta: string };
};

/**
 * Lê a resposta em fluxo, repassando o texto conforme chega.
 *
 * O laço continua recebendo a mesma mensagem montada de sempre — a diferença é
 * que o dono já ouviu o começo dela enquanto o resto era escrito.
 */
async function lerEmFluxo(
  corpo: ReadableStream<Uint8Array>,
  aoTexto: (pedaco: string) => void,
  sinal?: AbortSignal
): Promise<ProviderMessage> {
  const leitor = corpo.getReader();
  const decodificador = new TextDecoder();
  const estado = novoEstado();
  let pendente = "";
  /** Cópia integral, para o caso de a resposta não vir em quadros. */
  let bruto = "";

  try {
    while (true) {
      if (sinal?.aborted) break;

      const { done, value } = await leitor.read();
      if (done) break;

      const pedaco = decodificador.decode(value, { stream: true });
      bruto += pedaco;
      pendente += pedaco;

      const { deltas, resto } = lerQuadros(pendente);
      pendente = resto;

      for (const delta of deltas) {
        const novo = aplicarDelta(estado, delta);
        if (novo) aoTexto(novo);
      }
    }
  } finally {
    leitor.releaseLock?.();
  }

  const mensagem = montarMensagem(estado);
  if (mensagem.content || mensagem.tool_calls) return mensagem as ProviderMessage;

  /*
   * Nenhum quadro veio: o provedor ignorou o pedido de fluxo e respondeu de uma
   * vez. Acontece com proxies e com endpoints compatíveis que não implementam
   * streaming — tratar como resposta ilegível deixaria o Jarvis mudo por causa
   * de um detalhe de transporte que não muda nada no conteúdo.
   */
  try {
    const payload = JSON.parse(bruto) as { choices?: { message?: ProviderMessage }[] };
    const doCorpo = payload?.choices?.[0]?.message;
    if (doCorpo) {
      if (doCorpo.content) aoTexto(doCorpo.content);
      return doCorpo;
    }
  } catch {
    /* também não era JSON: cai no erro abaixo */
  }

  throw new JarvisProviderError("invalid_reply", "O provedor não retornou uma mensagem.");
}

async function callProvider(
  endpoint: string,
  apiKey: string,
  model: string,
  messages: ProviderMessage[],
  opcoes: {
    sinal?: AbortSignal;
    comFerramentas: boolean;
    /** Quais ferramentas entram no pedido. Ausente = todas. */
    permitidas?: readonly string[];
    /**
     * Recebe cada pedaço de texto assim que chega.
     *
     * Presente = pede a resposta em fluxo. A volta ao provedor custa cerca de
     * dois segundos mesmo para dizer "ok" — quase tudo é rede, não geração —
     * então esperar a resposta inteira desperdiça o tempo em que ela já está
     * sendo escrita.
     */
    aoTexto?: (pedaco: string) => void;
    /** Teto de tokens da saída. Ausente = o da rodada de ferramenta. */
    tetoDeSaida?: number;
    /** Interno: já dormiu uma vez nesta chamada. Impede laço de espera. */
    jaEsperou?: boolean;
  }
): Promise<ProviderMessage> {
  const limpo = messages.map(({ _podavel, ...resto }) => resto);
  const emFluxo = Boolean(opcoes.aoTexto);

  /**
   * Tenta o próximo modelo quando a cota deste acabou.
   *
   * Sem isto, "cota esgotada" era o fim do dia às sete da noite. Como o limite é
   * por modelo e a conta tem vários, a troca é transparente: o dono não vê nada
   * além de a resposta continuar vindo.
   */
  const tentarProximo = async (): Promise<ProviderMessage | null> => {
    const seguinte = proximoModelo(model);
    if (!seguinte) return null;
    console.warn(`[Modelo] trocando ${model} por ${seguinte}.`);
    return callProvider(endpoint, apiKey, seguinte, messages, opcoes);
  };

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: limpo,
        ...(opcoes.comFerramentas
          ? { tools: toolSchemas(opcoes.permitidas), tool_choice: "auto" }
          : { tool_choice: "none" }),
        temperature: 0.65,
        /*
         * Teto por FASE, não um número só.
         *
         * Nos modelos Gemini 3 os tokens de raciocínio saem deste mesmo teto.
         * Com 1200 para tudo, uma rodada que pensa um pouco gasta o teto
         * inteiro pensando e devolve `content` vazio — que virava
         * `invalid_reply` e, para o dono, "ele travou". A rodada que escolhe
         * ferramenta produz pouco texto e cabe folgada em 2048; a que ESCREVE
         * a resposta precisa de espaço de verdade.
         */
        max_tokens: opcoes.tetoDeSaida ?? 2048,
        ...(emFluxo ? { stream: true } : {}),
      }),
      signal: opcoes.sinal,
    });
  } catch (error) {
    if (opcoes.sinal?.aborted) {
      throw new JarvisProviderError("provider_failure", "Execução interrompida.");
    }
    throw new JarvisProviderError(
      "provider_failure",
      "Não foi possível alcançar o provedor de IA."
    );
  }

  // Em fluxo o corpo é lido aos poucos; fora dele, de uma vez. O erro precisa ser
  // conferido ANTES de consumir o corpo como fluxo, senão a mensagem de falha do
  // provedor viraria "quadro corrompido".
  if (emFluxo && response.ok && response.body) {
    desmarcar(model);
    return lerEmFluxo(response.body, opcoes.aoTexto!, opcoes.sinal);
  }

  const rawBody = await response.text().catch(() => "");

  if (!response.ok) {
    // A mensagem que sobe para a interface é curta de propósito, mas sem o corpo
    // no log não há como distinguir cota de modelo inválido ou instabilidade.
    console.error(`[Jarvis] Provedor respondeu ${response.status}: ${rawBody.slice(0, 400)}`);

    /*
     * O que a recusa SIGNIFICA decide o que fazer — não o número.
     *
     * Medido: o rodízio dizia que os cinco modelos estavam esgotados no dia;
     * sondados, três responderam na hora. O 429 do teto por MINUTO estava sendo
     * riscado como teto do DIA, e uma rajada de rodadas riscava a lista inteira
     * em segundos. Daí "reenviar" funcionar por um tempo e depois parar.
     */
    const recusa = classificarRecusa(response.status, rawBody);

    if (recusa.tipo === "dia") {
      marcarEsgotado(model);
      const doProximo = await tentarProximo();
      if (doProximo) return doProximo;
      throw new JarvisProviderError("quota_exceeded", describeProviderFailure(429));
    }

    if (recusa.tipo === "minuto" || recusa.tipo === "instavel") {
      // Outro modelo tem teto de minuto próprio e costuma responder já. Sem
      // riscar ninguém: o teto renova sozinho.
      const doProximo = await tentarProximo();
      if (doProximo) return doProximo;

      // A fila acabou. Uma espera, do tamanho que o provedor pediu, e a última
      // tentativa no mesmo modelo — uma só, para não virar laço.
      if (recusa.tipo === "minuto" && !opcoes.jaEsperou) {
        await dormir(recusa.esperaMs, opcoes.sinal);
        if (opcoes.sinal?.aborted) {
          throw new JarvisProviderError("provider_failure", "Execução interrompida.");
        }
        return callProvider(endpoint, apiKey, model, messages, { ...opcoes, jaEsperou: true });
      }

      throw new JarvisProviderError(
        recusa.tipo === "minuto" ? "quota_exceeded" : "provider_failure",
        recusa.tipo === "minuto"
          ? "O provedor pediu uma pausa. O limite por minuto renova sozinho."
          : describeProviderFailure(response.status),
        recusa.tipo === "minuto" ? recusa.esperaMs : undefined
      );
    }

    throw new JarvisProviderError("provider_failure", describeProviderFailure(response.status));
  }

  // Respondeu: se estava riscado por engano, a marca sai agora.
  desmarcar(model);

  let payload: { choices?: { message?: ProviderMessage }[] } | null = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error(`[Jarvis] Resposta ilegível do provedor: ${rawBody.slice(0, 200)}`);
  }

  const message = payload?.choices?.[0]?.message;
  if (!message) {
    throw new JarvisProviderError("invalid_reply", "O provedor não retornou uma mensagem.");
  }

  return message;
}

/**
 * Encolhe saídas antigas de ferramenta quando o contexto aperta.
 *
 * Sem isto, vinte e quatro saídas de seis mil caracteres são reenviadas a cada
 * uma das doze rodadas, e o custo em tokens cresce com o quadrado das rodadas.
 *
 * Três coisas mudaram, e as três importam:
 *
 * 1. O ORIGINAL NUNCA SE PERDE. Antes isto fazia `content = resumo` e o texto
 *    medido sumia para sempre — na rodada sete o modelo concluía sobre 160
 *    caracteres do que tinha medido na rodada um. Agora o original fica em
 *    `_podavel.original`, que `callProvider` já remove antes de ir à rede: não
 *    custa um byte de tráfego, só memória do processo.
 *
 * 2. PODA POR ORÇAMENTO, não por idade. Enquanto as saídas cruas couberem no
 *    teto, nada é podado — e na maioria dos turnos elas cabem. Contar rodadas
 *    jogava fora medição de graça em turno pequeno.
 *
 * 3. PODA GRADUADA. O primeiro corte ainda carrega números; só o que continuar
 *    estourando cai para a linha de 160.
 *
 * A primeira saída de cada ferramenta distinta nunca é podada: é a medição de
 * referência contra a qual todo o resto do turno é comparado.
 */
function podarConversa(conversa: ProviderMessage[]): void {
  const podaveis = conversa.filter((m) => m._podavel);
  const tamanho = (m: ProviderMessage) => (m.content ?? "").length;
  const total = () => podaveis.reduce((soma, m) => soma + tamanho(m), 0);
  if (total() <= TETO_DE_SAIDAS_CRUAS) return;

  const primeiraDaFerramenta = new Set<ProviderMessage>();
  const jaVistas = new Set<string>();
  for (const m of podaveis) {
    const nome = m._podavel!.ferramenta;
    if (!jaVistas.has(nome)) {
      jaVistas.add(nome);
      primeiraDaFerramenta.add(m);
    }
  }

  // Da mais antiga para a mais nova, em dois níveis, até caber.
  for (const nivel of [RESUMO_LARGO, RESUMO_CURTO]) {
    for (const m of podaveis) {
      if (total() <= TETO_DE_SAIDAS_CRUAS) return;
      if (primeiraDaFerramenta.has(m) && nivel === RESUMO_LARGO) continue;
      const encolhido =
        nivel === RESUMO_CURTO
          ? m._podavel!.resumo
          : resumirSaida(m._podavel!.original, m._podavel!.ok, RESUMO_LARGO);
      if (encolhido.length < tamanho(m)) m.content = encolhido;
    }
  }
}

/**
 * Devolve as saídas originais antes da chamada que ESCREVE a resposta.
 *
 * É a correção que mais importa de todas: o fechamento é a rodada em que o
 * modelo redige o que apurou, e ele estava lendo resumos de 160 caracteres do
 * próprio trabalho. Com o original de volta, a resposta final é escrita contra
 * os dados de verdade.
 *
 * Da mais recente para a mais antiga, porque se não couber tudo é o trabalho
 * recente que mais importa para a conclusão.
 */
function restaurarParaFechamento(conversa: ProviderMessage[], teto = TETO_NO_FECHAMENTO): void {
  let usado = 0;
  for (let i = conversa.length - 1; i >= 0; i -= 1) {
    const m = conversa[i];
    if (!m._podavel) continue;
    const original = m._podavel.original;
    if (usado + original.length > teto) continue;
    m.content = original;
    usado += original.length;
  }
}

/** Normaliza para comparar narrações e não falar duas vezes a mesma frase. */
function chaveDeNarracao(texto: string): string {
  return texto
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Conduz a conversa até uma resposta em texto.
 *
 * A ORDEM DENTRO DA RODADA é fixa e não muda:
 *   0. cancelado? sai sem emitir resposta
 *   1. emite `pensando`
 *   2. chama o provedor
 *   3. sem tool_calls -> resposta final (não gera narração)
 *   4. com tool_calls e texto junto -> emite `narracao` (única fonte falada)
 *   5. por chamada: dedup -> risco -> `acao_inicio` -> executa -> `acao_fim`
 *   6. poda o contexto
 *   7. contabiliza a rodada
 */
export async function generateJarvisReply(
  mensagens: JarvisChatMessage[],
  opcoes: OpcoesJarvis = {}
): Promise<RespostaDoJarvis> {
  const { apiKey, endpoint } = getGeminiConfiguration();
  // Por rodada, não por turno: se o rodízio trocou de modelo no meio, a rodada
  // seguinte segue no que respondeu em vez de pagar um 429 para redescobrir.
  let model = modeloAtual();
  const orcamento: OrcamentoDeExecucao = { ...ORCAMENTO_PADRAO, ...opcoes.orcamento };
  const sinal = opcoes.sinal ?? new AbortController().signal;
  const emitir = opcoes.aoEvento ?? (() => {});

  let estado: EstadoDoOrcamento = iniciarOrcamento();
  const historicoDeTentativas: RegistroDeTentativa[] = [];
  const actions: AcaoJarvis[] = [];
  const narracoesDitas = new Set<string>();

  const janela = mensagens.slice(-JANELA_DE_HISTORICO);

  const conversa: ProviderMessage[] = [
    {
      role: "system",
      content: construirInstrucaoDeSistema({
        dono: process.env.OWNER_NAME?.trim() || "Edson",
        agora: new Date(),
        relatorioDaMaquina: opcoes.relatorioDaMaquina,
        memoria: opcoes.memorias,
      }),
    },
    // O histórico carrega as ações já executadas: é o que impede o Jarvis de
    // refazer a medição que acabou de fazer no turno anterior.
    ...janela.map((mensagem) => ({
      role: mensagem.role,
      content: comRecapitulacao(mensagem as MensagemDeFio),
    })),
  ];

  const contextoBase = {
    execucaoId: opcoes.execucaoId ?? randomUUID(),
    sinal,
    emitir,
    interativo: opcoes.interativo ?? true,
    autorizacoes: new Set<string>(),
    destravarGrupo: (prefixo: string) => {
      if (!ferramentasUsadas.includes(prefixo)) ferramentasUsadas.push(prefixo);
    },
    perguntasFeitas: 0,
    creditarEspera: (ms: number) => {
      estado = creditarEspera(estado, ms);
    },
  };

  const fecharCancelado = (): RespostaDoJarvis => ({
    reply: "",
    fala: "",
    model,
    actions,
    motivoDeParada: "cancelado",
  });

  /*
   * Quais ferramentas entram no pedido deste turno.
   *
   * Medido: o catálogo inteiro são 60 KB de esquema em CADA rodada, e levava
   * uma saudação a 131 segundos. As nativas são baratas e ficam sempre; agenda
   * e e-mail só entram quando a conversa pede.
   */
  const todasAsFerramentas = nomesDasFerramentas();
  const pedidoDoDono = [...mensagens].reverse().find((m) => m.role === "user")?.content ?? "";
  /*
   * O grupo sobrevive ao TURNO, não só à rodada.
   *
   * Era um array local recriado a cada turno: um "e amanhã?" logo depois de
   * "vê minha agenda" perdia a agenda que ele acabou de usar, e ele respondia
   * "não tenho acesso à sua agenda". Não precisa de estado novo — o histórico
   * já carrega as ações de cada turno, e o banco as restaura.
   *
   * Três turnos de memória: o bastante para o acompanhamento, pouco o bastante
   * para uma pergunta de agenda de ontem não taxar todo pedido de hoje.
   */
  const ferramentasUsadas: string[] = janela
    .filter((m) => m.role === "assistant")
    .slice(-TURNOS_QUE_LEMBRAM_O_GRUPO)
    .flatMap((m) => (m as { acoes?: { name: string }[] }).acoes ?? [])
    .map((a) => a.name);

  // Uma vez por turno: sem isto ninguém consegue ver o que o filtro cortou.
  let jaLogou = false;
  const permitidasAgora = () => {
    const escolhidas = selecionarFerramentas({
      disponiveis: todasAsFerramentas,
      pedido: pedidoDoDono,
      jaUsadas: ferramentasUsadas,
    });
    if (!jaLogou) {
      jaLogou = true;
      console.info(`[Ferramentas] ${resumirSelecao(todasAsFerramentas, escolhidas)}`);
    }
    return escolhidas;
  };

  let rodada = 0;
  let motivoDeParada: MotivoDeParada = "concluido";

  while (true) {
    if (sinal.aborted) return fecharCancelado();

    if (orcamentoEstourado(estado, orcamento)) {
      motivoDeParada = "orcamento";
      break;
    }
    if (deveDesistir(historicoDeTentativas)) {
      motivoDeParada = "falhas";
      break;
    }

    rodada += 1;
    emitir({ tipo: "pensando", rodada });

    if (deveAvisar(estado, orcamento)) {
      conversa.push({
        role: "system",
        content: notaDeOrcamento(rodadasRestantes(estado, orcamento)),
      });
    }

    let mensagem: ProviderMessage;
    try {
      model = modeloAtual();
      mensagem = await callProvider(endpoint, apiKey, model, conversa, {
        sinal,
        comFerramentas: true,
        permitidas: permitidasAgora(),
        /*
         * A resposta final nasce numa rodada SEM chamadas, e é a única que fica
         * longa — resumo, explicação, relato do que foi feito. Emitir os pedaços
         * conforme chegam adianta alguns segundos justamente nesses casos. Em
         * resposta curta o provedor entrega tudo de uma vez e isto não custa
         * nada nem atrapalha.
         */
        aoTexto: (pedaco) => emitir({ tipo: "resposta_parcial", texto: pedaco }),
      });
    } catch (error) {
      if (sinal.aborted) return fecharCancelado();
      // Cota estourada com trabalho já feito não é erro: é hora de fechar com o
      // que foi apurado. Tratar como falha jogaria fora rodadas de execução real
      // e ofereceria um "reenviar" que reexecutaria efeitos já aplicados.
      if (error instanceof JarvisProviderError && error.kind === "quota_exceeded" && actions.length > 0) {
        motivoDeParada = "orcamento";
        break;
      }
      throw error;
    }

    if (sinal.aborted) return fecharCancelado();

    const chamadas = mensagem.tool_calls ?? [];

    if (chamadas.length === 0) {
      let texto = mensagem.content?.trim();

      /*
       * Resposta vazia sem chamada de ferramenta quase sempre é teto de saída
       * consumido pelo raciocínio, não defeito do provedor. Uma segunda
       * tentativa com espaço de sobra resolve — e é muito melhor que devolver
       * "ele travou" ao dono. Uma só, para não virar laço nem queimar cota.
       */
      if (!texto) {
        console.warn("[Jarvis] resposta vazia; repetindo com teto maior.");
        const segunda = await callProvider(endpoint, apiKey, model, conversa, {
          sinal,
          comFerramentas: false,
          tetoDeSaida: TETO_RESPOSTA,
          aoTexto: (pedaco) => emitir({ tipo: "resposta_parcial", texto: pedaco }),
        }).catch(() => null);
        texto = segunda?.content?.trim();
      }

      if (!texto) {
        throw new JarvisProviderError(
          "invalid_reply",
          "O provedor não retornou uma resposta de texto utilizável."
        );
      }
      return {
        reply: texto,
        fala: falaDaResposta(texto),
        model,
        actions,
        motivoDeParada: "concluido",
      };
    }

    // Texto junto de chamadas é a narração: a única fonte de fala durante a
    // execução. A resposta final (acima) nunca vira narração, senão o mesmo
    // conteúdo seria falado duas vezes.
    const narracao = mensagem.content?.trim();
    /** O modelo já anunciou esta rodada? Se sim, a primeira ação não repete. */
    let jaAnunciouNestaRodada = false;
    if (narracao) {
      const chave = chaveDeNarracao(narracao);
      if (chave && !narracoesDitas.has(chave)) {
        narracoesDitas.add(chave);
        emitir({ tipo: "narracao", texto: narracao, origem: "modelo", rodada });
        jaAnunciouNestaRodada = true;
      }
    }

    conversa.push(mensagem);

    /**
     * Contado pelo que REALMENTE executou, nunca pelo nome da ferramenta.
     *
     * A versão anterior decidia "só perguntou" olhando o nome ANTES da
     * deduplicação. Quando o modelo repetia a mesma pergunta, a chamada era
     * barrada, nada executava — e a rodada mesmo assim entrava como gratuita.
     * Orçamento parado, histórico de falhas parado, e o laço girava dezenas de
     * vezes até estourar o relógio: dois minutos de Jarvis mudo, só pulsos de
     * "pensando", terminando sem ter feito nada. Era exatamente o que o
     * comentário antigo prometia impedir.
     */
    let chamadasExecutadas = 0;
    let perguntasExecutadas = 0;
    let outrasExecutadas = 0;

    for (const chamada of chamadas) {
      if (sinal.aborted) return fecharCancelado();

      const nome = chamada.function.name;
      const argumentos = chamada.function.arguments;
      const assinatura = assinaturaDaChamada(nome, argumentos);

      const decisao = avaliarTentativa(historicoDeTentativas, nome, assinatura);
      if (!decisao.permitir) {
        conversa.push({ role: "tool", tool_call_id: chamada.id, content: decisao.aviso });
        continue;
      }

      let args: Record<string, unknown> = {};
      try {
        args = argumentos ? JSON.parse(argumentos) : {};
      } catch {
        /* invokeTool devolve o erro de parsing */
      }

      /*
       * ANUNCIA ANTES DE FAZER.
       *
       * A ordem tem que ser pensar, falar, executar — e falar ENQUANTO executa,
       * dizendo o que está executando. Quando o modelo já narrou, essa é a fala
       * da rodada. Quando ele chamou a ferramenta calado — que é o caso comum —
       * o anúncio sai daqui, da frase que a própria ferramenta declara.
       *
       * É emitido antes do `invokeTool` de propósito: a síntese roda no cliente
       * ao mesmo tempo em que a ferramenta trabalha aqui, então a voz entra
       * junto com o trabalho em vez de depois dele. As frases fixas já estão
       * sintetizadas em cache, então o anúncio é imediato.
       */
      if (jaAnunciouNestaRodada) {
        // A fala do modelo cobre a primeira ação; da segunda em diante, cada uma
        // se anuncia, senão ele executaria três coisas tendo falado de uma.
        jaAnunciouNestaRodada = false;
      } else {
        const anuncio = narrarChamada(nome, args);
        const chaveDoAnuncio = chaveDeNarracao(anuncio);
        if (chaveDoAnuncio && !narracoesDitas.has(chaveDoAnuncio)) {
          narracoesDitas.add(chaveDoAnuncio);
          emitir({ tipo: "narracao", texto: anuncio, origem: "sistema", rodada });
        }
      }

      const acaoId = randomUUID();

      // Quem emite `acao_inicio` é o invokeTool, DEPOIS de passar pela trava de
      // risco. Emitir aqui faria a interface mostrar "executando" durante a
      // confirmação, para uma ação que talvez nem role.
      const ctx: ContextoDeExecucao = {
        ...contextoBase,
        acaoId,
        prazoMs: msRestantes(estado, orcamento),
      };

      const resultado: ToolOutcome = await invokeTool(nome, argumentos, ctx);
      chamadasExecutadas += 1;
      // O grupo desta ferramenta continua no pedido até o fim do turno: sem
      // isto, a rodada seguinte perderia justamente o que ele acabou de usar.
      if (!ferramentasUsadas.includes(nome)) ferramentasUsadas.push(nome);
      if (nome === "perguntar_ao_usuario") perguntasExecutadas += 1;
      else outrasExecutadas += 1;

      emitir({
        tipo: "acao_fim",
        acaoId,
        ferramenta: nome,
        detalhe: resultado.detail,
        ok: resultado.ok,
        bloqueada: resultado.bloqueada,
        duracaoMs: resultado.duracaoMs,
        resumo: resultado.resumo,
      });

      // Trilha permanente do que foi feito, fora da conversa. Nunca aguardada.
      registrarAcao({
        execucaoId: contextoBase.execucaoId,
        ferramenta: nome,
        detalhe: resultado.detail,
        resumo: resultado.resumo,
        ok: resultado.ok,
        bloqueada: resultado.bloqueada,
        duracaoMs: resultado.duracaoMs,
        pedido: pedidoDoDono,
      });

      historicoDeTentativas.push({
        ferramenta: nome,
        assinatura,
        ok: resultado.ok && !resultado.suspeita,
        // Recusa do dono é decisão, não defeito: fica registrada para o modelo
        // não insistir, mas não empurra o turno para o encerramento por falhas.
        recusada: resultado.bloqueada,
      });

      if (!resultado.bloqueada) {
        actions.push({
          name: resultado.name,
          detail: resultado.detail,
          ok: resultado.ok,
          resumo: resultado.resumo,
        });
      }

      conversa.push({
        role: "tool",
        tool_call_id: chamada.id,
        content: resultado.output,
        _podavel: {
          rodada,
          resumo: resultado.resumo,
          // Guardado para o fechamento ler o que foi medido, não o resumo.
          original: resultado.output,
          ok: resultado.ok,
          ferramenta: nome,
        },
      });

      if (sinal.aborted) return fecharCancelado();
    }

    podarConversa(conversa);

    /*
     * Gratuita só quando a rodada foi INTEIRAMENTE de pergunta e tudo o que o
     * modelo pediu chegou a executar. Perguntar precisa ser barato, senão ele
     * aprende a não perguntar — mas uma rodada em que nada rodou tem de custar,
     * ou o laço nunca termina.
     */
    const gratuita =
      perguntasExecutadas > 0 &&
      outrasExecutadas === 0 &&
      chamadasExecutadas === chamadas.length;

    estado = registrarRodada(estado, chamadasExecutadas, gratuita);
  }

  /* ------------------------- fechamento ------------------------- */

  if (sinal.aborted) return fecharCancelado();

  emitir({
    tipo: "narracao",
    texto: "Já reuni o suficiente. Vou fechar o raciocínio.",
    origem: "sistema",
    rodada: rodada + 1,
  });

  let fechamento: ProviderMessage | null = null;
  try {
    model = modeloAtual();
    // A rodada que ESCREVE a resposta lê o que foi medido, não o resumo dele.
    restaurarParaFechamento(conversa);
    fechamento = await callProvider(
      endpoint,
      apiKey,
      model,
      [...conversa, { role: "system", content: notaDeFechamento(motivoDeParada) }],
      { sinal, comFerramentas: false, tetoDeSaida: TETO_RESPOSTA }
    );
  } catch (error) {
    if (sinal.aborted) return fecharCancelado();
    // Sem fechamento, ainda é melhor relatar o que foi feito do que estourar um
    // erro em cima de várias execuções reais.
    console.warn("[Jarvis] Fechamento falhou:", String(error).slice(0, 160));
  }

  const texto = fechamento?.content?.trim();
  if (texto) {
    return { reply: texto, fala: falaDaResposta(texto), model, actions, motivoDeParada };
  }

  // Fechamento vazio ou falho: monta uma resposta determinística com o que foi
  // apurado. Jogar fora várias rodadas de trabalho real por causa de uma
  // mensagem vazia seria o pior desfecho possível.
  const reply = montarRespostaDeterministica(actions, motivoDeParada);
  return { reply, fala: falaDaResposta(reply), model, actions, motivoDeParada };
}

function montarRespostaDeterministica(
  actions: AcaoJarvis[],
  motivo: MotivoDeParada
): string {
  if (actions.length === 0) {
    return motivo === "falhas"
      ? "Não consegui concluir, senhor. As tentativas falharam e parei para não insistir no mesmo caminho."
      : "Não cheguei a uma conclusão dentro do limite desta execução, senhor.";
  }

  const ultimas = actions.slice(-3);
  const relato = ultimas
    .map((acao) => `${acao.name}: ${acao.resumo || (acao.ok ? "concluído" : "falhou")}`)
    .join("; ");

  return (
    `Executei ${actions.length} ${actions.length === 1 ? "ação" : "ações"}, senhor. ` +
    `As últimas foram ${relato}. ` +
    (motivo === "falhas"
      ? "Parei porque as tentativas seguintes falharam."
      : "Parei no limite desta execução; posso continuar se o senhor pedir.")
  );
}

/** Reexportado para quem monta resumo fora do laço. */
export { resumirSaida };
