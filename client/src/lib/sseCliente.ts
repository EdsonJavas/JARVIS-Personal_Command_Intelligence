import type { EventoJarvis } from "@shared/jarvisStream";

/**
 * Leitor de fluxo SSE.
 *
 * Não se usa `EventSource` porque ele só faz GET e não manda corpo — e aqui o
 * pedido é um POST com o histórico da conversa. Então o fluxo vem por `fetch` e
 * os quadros são remontados à mão.
 */

/**
 * Lê o corpo até o fim, entregando cada evento decodificado.
 *
 * A rede não respeita fronteira de quadro: um pedaço pode chegar cortado no meio
 * do JSON. Por isso o resto de cada leitura fica no acumulador até fechar o
 * quadro com a linha em branco.
 */
export async function lerFluxoSse(
  corpo: ReadableStream<Uint8Array>,
  aoEvento: (evento: EventoJarvis) => void,
  sinal?: AbortSignal
): Promise<void> {
  const leitor = corpo.getReader();
  const decodificador = new TextDecoder();
  let acumulado = "";

  try {
    while (true) {
      if (sinal?.aborted) break;

      const { done, value } = await leitor.read();
      if (done) break;

      acumulado += decodificador.decode(value, { stream: true });

      let corte = acumulado.indexOf("\n\n");
      while (corte !== -1) {
        const quadro = acumulado.slice(0, corte);
        acumulado = acumulado.slice(corte + 2);
        processarQuadro(quadro, aoEvento);
        corte = acumulado.indexOf("\n\n");
      }
    }
  } finally {
    leitor.releaseLock?.();
  }
}

function processarQuadro(quadro: string, aoEvento: (evento: EventoJarvis) => void): void {
  const linhas = quadro.split("\n");
  const dados: string[] = [];
  let tipo = "";

  for (const linha of linhas) {
    // Comentário: é o keep-alive. Não vira evento nem mexe na sequência.
    if (linha.startsWith(":")) return;
    if (linha.startsWith("event:")) tipo = linha.slice(6).trim();
    else if (linha.startsWith("data:")) dados.push(linha.slice(5).trimStart());
  }

  if (tipo === "fim") return;
  if (dados.length === 0) return;

  try {
    const evento = JSON.parse(dados.join("\n")) as EventoJarvis;
    if (evento && typeof evento.tipo === "string") aoEvento(evento);
  } catch {
    /* quadro corrompido: ignorar é melhor que derrubar o fluxo inteiro */
  }
}
