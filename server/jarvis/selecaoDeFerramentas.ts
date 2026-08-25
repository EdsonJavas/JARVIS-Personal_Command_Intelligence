/**
 * Quais ferramentas entram no pedido desta conversa.
 *
 * Mandar o catálogo inteiro a cada rodada custou caro e foi medido: com as 32
 * nativas, uma saudação levava 10 segundos; somando agenda e e-mail — 64
 * ferramentas, 60 KB de esquema — subiu para 131 SEGUNDOS. A integração com o
 * Google, sozinha, tornava o assistente inutilizável.
 *
 * Só a agenda são 33 KB, e um único `create-event` tem 9,8 KB. Esse peso viaja
 * em TODA rodada, mesmo quando o dono só perguntou como está a máquina.
 *
 * A solução é escolher: as nativas são baratas e ficam sempre; os grupos
 * externos entram quando a conversa dá sinal de que são necessários. Errar para
 * menos é recuperável — o modelo diz que não consegue e o dono reformula. Errar
 * para mais custa dois minutos de espera em toda pergunta.
 */

export type GrupoExterno = {
  /** Prefixo das ferramentas, como a ponte MCP as nomeia. */
  prefixo: string;
  /** Palavras que indicam que este grupo é relevante. Sem acento, minúsculas. */
  gatilhos: RegExp;
};

export const GRUPOS: GrupoExterno[] = [
  {
    prefixo: "agenda_",
    gatilhos:
      /\b(agenda|calendario|calendar|evento|eventos|reuniao|reunioes|compromisso|compromissos|marcar|marque|marcado|agendar|agende|remarcar|horario|disponibilidade|disponivel|ocupado|livre|semana|compromet)/,
  },
  {
    prefixo: "email_",
    gatilhos:
      /\b(email|e-mail|emails|mensagem|mensagens|caixa de entrada|inbox|gmail|remetente|destinatario|responder|responda|encaminhar|enviar|envie|rascunho|spam|anexo|assinatura|nao lidos|nao lidas)/,
  },
];

/** Minúsculas e sem acento: "reunião" e "reuniao" têm que casar igual. */
function normalizar(texto: string): string {
  return String(texto ?? "")
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export type EntradaDeSelecao = {
  /** Nome de toda ferramenta disponível. */
  disponiveis: string[];
  /** O que o dono escreveu ou disse neste turno. */
  pedido: string;
  /**
   * Ferramentas já chamadas neste turno.
   *
   * Um grupo que entrou precisa CONTINUAR entrando: sem isto, a rodada seguinte
   * perderia a ferramenta que o modelo acabou de usar, e ele repetiria a
   * pergunta ou desistiria no meio da tarefa.
   */
  jaUsadas?: string[];
};

/**
 * Devolve os nomes que devem ir no pedido.
 *
 * As nativas entram sempre — são 14 KB no total e cobrem o uso diário. Só os
 * grupos externos, que são caros, passam pelo filtro.
 */
export function selecionarFerramentas({
  disponiveis,
  pedido,
  jaUsadas = [],
}: EntradaDeSelecao): string[] {
  const texto = normalizar(pedido);

  const prefixosAtivos = new Set<string>();
  for (const grupo of GRUPOS) {
    if (grupo.gatilhos.test(texto)) prefixosAtivos.add(grupo.prefixo);
  }

  // Grupo cuja ferramenta já foi usada continua disponível até o fim do turno.
  for (const usada of jaUsadas) {
    for (const grupo of GRUPOS) {
      if (usada.startsWith(grupo.prefixo)) prefixosAtivos.add(grupo.prefixo);
    }
  }

  return disponiveis.filter((nome) => {
    const grupo = GRUPOS.find((g) => nome.startsWith(g.prefixo));
    // Sem grupo é nativa: sempre entra.
    if (!grupo) return true;
    return prefixosAtivos.has(grupo.prefixo);
  });
}

/** Para o log: o que foi cortado e por quê. */
export function resumirSelecao(disponiveis: string[], escolhidas: string[]): string {
  const cortadas = disponiveis.length - escolhidas.length;
  if (cortadas === 0) return `${escolhidas.length} ferramentas`;
  return `${escolhidas.length} de ${disponiveis.length} ferramentas (${cortadas} fora do assunto)`;
}
