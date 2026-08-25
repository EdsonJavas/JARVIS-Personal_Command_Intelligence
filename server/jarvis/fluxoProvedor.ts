/**
 * Remontagem da resposta do modelo quando ela vem em fluxo.
 *
 * Sem streaming, o servidor espera a resposta INTEIRA antes de emitir qualquer
 * coisa — e a volta ao provedor custa cerca de dois segundos mesmo para dizer
 * "ok", porque quase tudo é rede, não geração. Em fluxo, o texto começa a sair
 * em torno de meio segundo, e é isso que muda a sensação de uso.
 *
 * A remontagem fica aqui, separada da rede, porque é a parte que erra fácil: o
 * texto chega em pedaços e as chamadas de ferramenta chegam FRAGMENTADAS POR
 * ÍNDICE — o nome numa parte, um pedaço dos argumentos na seguinte, o resto
 * depois. Montar isso errado produz um JSON truncado que o modelo parece ter
 * pedido, e o defeito só apareceria na execução da ferramenta errada.
 */

export type ChamadaDeFerramenta = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  /**
   * Campo opaco do provedor, devolvido intacto na rodada seguinte.
   *
   * O Gemini 3 põe aqui a `thought_signature` da chamada, e EXIGE que ela volte
   * junto quando o resultado da ferramenta é enviado. Descartada, a rodada de
   * fechamento morre com 400 — e o dono vê a resposta genérica de fallback em
   * vez do relato real, sem nada indicando o motivo.
   *
   * Tratado como caixa-preta de propósito: não interpretamos o conteúdo, apenas
   * carregamos de volta. Assim outro provedor com outro campo continua servido.
   */
  extra_content?: unknown;
};

export type MensagemMontada = {
  role: "assistant";
  content: string | null;
  tool_calls?: ChamadaDeFerramenta[];
};

/** Pedaço de resposta, no formato do endpoint compatível com OpenAI. */
export type Delta = {
  content?: string | null;
  tool_calls?: Array<{
    index?: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
    extra_content?: unknown;
  }>;
};

export type EstadoDoFluxo = {
  texto: string;
  /** Por índice, e não por ordem de chegada: os fragmentos vêm intercalados. */
  chamadas: Map<number, { id: string; nome: string; argumentos: string; extra?: unknown }>;
};

export function novoEstado(): EstadoDoFluxo {
  return { texto: "", chamadas: new Map() };
}

/**
 * Aplica um pedaço ao estado.
 *
 * Devolve o texto novo deste pedaço — e não o acumulado — para quem estiver
 * repassando ao cliente não precisar calcular a diferença.
 */
export function aplicarDelta(estado: EstadoDoFluxo, delta: Delta): string {
  let textoNovo = "";

  if (typeof delta.content === "string" && delta.content.length > 0) {
    estado.texto += delta.content;
    textoNovo = delta.content;
  }

  for (const fragmento of delta.tool_calls ?? []) {
    // Índice ausente significa a primeira e única chamada: alguns provedores o
    // omitem quando há só uma.
    const indice = fragmento.index ?? 0;
    const atual = estado.chamadas.get(indice) ?? { id: "", nome: "", argumentos: "" };

    if (fragmento.id) atual.id = fragmento.id;
    // Chega uma vez só, no fragmento que traz o nome; não sobrescrever com
    // undefined nos fragmentos seguintes é o que a guarda garante.
    if (fragmento.extra_content !== undefined) atual.extra = fragmento.extra_content;
    if (fragmento.function?.name) atual.nome = fragmento.function.name;
    // Argumentos são CONCATENADOS, nunca substituídos: cada pedaço traz um
    // trecho do JSON, e sobrescrever deixaria só o último fragmento.
    if (fragmento.function?.arguments) atual.argumentos += fragmento.function.arguments;

    estado.chamadas.set(indice, atual);
  }

  return textoNovo;
}

/** Fecha o estado na mensagem que o laço espera. */
export function montarMensagem(estado: EstadoDoFluxo): MensagemMontada {
  const chamadas = [...estado.chamadas.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, chamada]) => chamada.nome)
    .map(([indice, chamada], ordem) => ({
      // Provedor que não mande id ainda precisa de um: é a chave que casa a
      // resposta da ferramenta com a chamada, e repetir id embaralharia tudo.
      id: chamada.id || `call_${indice}_${ordem}`,
      type: "function" as const,
      function: { name: chamada.nome, arguments: chamada.argumentos || "{}" },
      ...(chamada.extra !== undefined ? { extra_content: chamada.extra } : {}),
    }));

  return {
    role: "assistant",
    content: estado.texto.length > 0 ? estado.texto : null,
    ...(chamadas.length > 0 ? { tool_calls: chamadas } : {}),
  };
}

/**
 * Extrai os deltas de um bloco de texto no formato SSE.
 *
 * Devolve também o que sobrou sem terminar, porque a rede não respeita fronteira
 * de quadro: um pedaço pode chegar cortado no meio do JSON, e descartá-lo
 * perderia parte da resposta em silêncio.
 */
export function lerQuadros(acumulado: string): { deltas: Delta[]; resto: string } {
  const deltas: Delta[] = [];
  const linhas = acumulado.split("\n");
  // A última linha pode estar incompleta; volta para o acumulador.
  const resto = linhas.pop() ?? "";

  for (const linha of linhas) {
    const limpa = linha.trim();
    if (!limpa.startsWith("data:")) continue;

    const dados = limpa.slice(5).trim();
    if (dados === "[DONE]") continue;

    try {
      const quadro = JSON.parse(dados) as { choices?: Array<{ delta?: Delta }> };
      const delta = quadro.choices?.[0]?.delta;
      if (delta) deltas.push(delta);
    } catch {
      // Quadro corrompido: ignorar é melhor que derrubar a resposta inteira.
    }
  }

  return { deltas, resto };
}
