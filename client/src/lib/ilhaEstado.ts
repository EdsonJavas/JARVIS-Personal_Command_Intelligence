/**
 * O que a ilha mostra, decidido longe do desenho.
 *
 * A ilha tem quatro formas e muda entre elas sozinha, conforme o que ele está
 * fazendo. A decisão mora aqui, testável, porque é ela que pode dar errado de
 * um jeito que custa caro: uma pergunta pendente com a ilha fechada deixa a
 * execução parada sem que o dono saiba por quê.
 */

/**
 * - repouso: a pílula pequena no alto da tela. Nada acontecendo.
 * - atividade: a pílula alarga e mostra, numa linha, o que ele está fazendo.
 * - aviso: cresce um pouco para um recado que chegou sozinho (lembrete, erro).
 * - expandida: o cartão onde se conversa com ele.
 */
export type FormaDaIlha = "repouso" | "atividade" | "aviso" | "expandida";

export type EntradaDaForma = {
  /** O dono abriu, com clique ou atalho. */
  abertaPeloDono: boolean;
  /** Há pergunta esperando resposta: a execução está parada. */
  temPergunta: boolean;
  /** Recado passageiro sendo mostrado agora, se houver. */
  aviso: "iniciativa" | "erro" | null;
  /** Ele está pensando, ouvindo ou falando. */
  emAtividade: boolean;
};

export function formaDaIlha(entrada: EntradaDaForma): FormaDaIlha {
  /*
   * Pergunta abre a ilha mesmo que o dono não tenha aberto. Ação destrutiva só
   * se confirma por clique, e não há onde clicar numa pílula fechada.
   */
  if (entrada.abertaPeloDono || entrada.temPergunta) return "expandida";
  if (entrada.aviso) return "aviso";
  if (entrada.emAtividade) return "atividade";
  return "repouso";
}

export type TipoDeAtividade = "conectando" | "ouvindo" | "pensando" | "falando";

export type AtividadeDaIlha = { tipo: TipoDeAtividade; texto: string };

export type EntradaDaAtividade = {
  pending: boolean;
  narracao: string | null;
  respostaParcial: string | null;
  acoesEmCurso: ReadonlyArray<{ detalhe: string }>;
  aoVivoAtivo: boolean;
  aoVivoConectando: boolean;
  aoVivoFalando: boolean;
  /** A voz ainda lendo a resposta, depois de a execução já ter terminado. */
  vozFalando: boolean;
  /** A última resposta dele, para a legenda enquanto a voz termina de ler. */
  ultimaResposta: string | null;
};

/**
 * Teto de texto na pílula alargada. Passa do que cabe de propósito: o desenho
 * mostra o fim e esmaece o começo, então sobrar à esquerda não custa nada.
 */
const CABE_NA_PILULA = 120;

/**
 * Uma linha sobre o que ele está fazendo agora, ou nada.
 *
 * A ordem importa. Resposta sendo escrita vence narração: quando o texto da
 * resposta começa a chegar, a narração da ação anterior já é passado.
 */
export function atividadeDaIlha(entrada: EntradaDaAtividade): AtividadeDaIlha | null {
  const linha = (texto: string) => trechoFinal(texto, CABE_NA_PILULA);

  if (entrada.aoVivoConectando) return { tipo: "conectando", texto: "conectando…" };

  if (entrada.aoVivoAtivo) {
    if (entrada.aoVivoFalando) {
      return { tipo: "falando", texto: entrada.respostaParcial ? linha(entrada.respostaParcial) : "" };
    }
    // No modo ao vivo a narração carrega o que o DONO disse: é o eco de que
    // ele foi ouvido.
    return { tipo: "ouvindo", texto: entrada.narracao ? linha(entrada.narracao) : "ouvindo" };
  }

  if (entrada.pending) {
    if (entrada.respostaParcial?.trim()) {
      return { tipo: "falando", texto: linha(entrada.respostaParcial) };
    }
    if (entrada.narracao?.trim()) return { tipo: "pensando", texto: linha(entrada.narracao) };
    const acao = entrada.acoesEmCurso[entrada.acoesEmCurso.length - 1];
    if (acao?.detalhe.trim()) return { tipo: "pensando", texto: linha(acao.detalhe) };
    return { tipo: "pensando", texto: "pensando…" };
  }

  if (entrada.vozFalando) {
    return { tipo: "falando", texto: entrada.ultimaResposta ? linha(entrada.ultimaResposta) : "" };
  }

  return null;
}

/**
 * O fim de um texto, numa linha.
 *
 * Pelo FIM, não pelo começo: numa resposta que está chegando, o que importa é a
 * frase que acabou de entrar. Corta numa fronteira de palavra e marca o corte
 * com reticências, para não começar a linha com meia palavra.
 */
export function trechoFinal(texto: string, maximo: number): string {
  const limpo = texto
    .replace(/\*\*|__|`/g, "")
    .replace(/^[#>\s]+/gm, "")
    .replace(/\s+/g, " ")
    .trim();

  if (limpo.length <= maximo) return limpo;

  const cauda = limpo.slice(limpo.length - (maximo - 1));
  const espaco = cauda.indexOf(" ");
  const inicio = espaco >= 0 && espaco < cauda.length - 1 ? cauda.slice(espaco + 1) : cauda;
  return `…${inicio}`;
}
