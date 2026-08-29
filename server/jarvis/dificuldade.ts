/**
 * O pedido exige raciocínio, ou é despachar uma ferramenta?
 *
 * A escada de modelos tem um lado rápido e um profundo, e a diferença medida é
 * brutal: 5,7 s no `gemini-3.6-flash` contra 12,9 s no `gemini-3.7-flash`, que
 * pensa antes de responder. Gastar o profundo em "que horas são" faria o
 * assistente parecer travado, não inteligente.
 *
 * A classificação é LOCAL e determinística de propósito. Perguntar ao modelo
 * "isto é difícil?" dobraria as requisições contra uma cota de vinte por dia
 * por modelo — exatamente o custo que esta função existe para evitar.
 *
 * Erra para o lado barato: na dúvida, rápido. Uma resposta boa e lenta demais
 * incomoda mais que uma resposta rasa e imediata, porque o dono reformula.
 */

export type NivelDeModelo = "rapido" | "profundo";

/** Verbos e marcas de quem está pedindo raciocínio, não execução. */
const PEDE_RACIOCINIO =
  /\b(por ?que|porqu|explic|compar|analis|avali|planej|estrateg|vale a pena|decid|arquitet|revis|refator|diagnostic|investig|entend|o que aconteceu|faz sentido|qual (e|é) melhor|prefer(e|ivel)|recomend|sugir|opini|deveria|melhor(ar|ia)?)/;

/** Pedido curto e direto: despacha uma ferramenta e pronto. */
const IMPERATIVO_DE_MAQUINA =
  /^(abre|abra|abrir|liga|ligar|desliga|toca|tocar|pausa|aumenta|diminui|volume|que horas|quanto (de|tem|sobrou)|onde fica|trava|bloqueia|limpa|copia|cola|fecha|minimiza|silencia|muta)\b/;

const SAUDACAO = /^(oi|ol[aá]|bom dia|boa tarde|boa noite|e a[ií]|opa|tudo bem|obrigad|valeu|beleza|blz)\b/;

function normalizar(texto: string): string {
  return String(texto ?? "")
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

export function classificarDificuldade(entrada: {
  pedido: string;
  acoesExecutadas?: number;
  ferramentasUsadas?: string[];
}): { nivel: NivelDeModelo; motivo: string } {
  const texto = normalizar(entrada.pedido);
  const palavras = texto.split(/\s+/).filter(Boolean);

  /*
   * O CONTEXTO vem antes da forma do pedido.
   *
   * "e agora?" tem três palavras, mas depois de três ferramentas executadas a
   * resposta é uma síntese do que foi apurado — e é justamente aí que o modelo
   * profundo vale o que custa. Olhar só o tamanho da frase classificaria isso
   * como trivial.
   */
  if ((entrada.acoesExecutadas ?? 0) >= 3) {
    return { nivel: "profundo", motivo: "três ou mais ações executadas" };
  }
  const usadas = entrada.ferramentasUsadas ?? [];
  if (usadas.some((n) => n === "buscar_na_web" || n === "mostrar_no_painel")) {
    return { nivel: "profundo", motivo: "resultado a sintetizar" };
  }

  if (PEDE_RACIOCINIO.test(texto)) return { nivel: "profundo", motivo: "pede raciocínio" };
  if (texto.length > 180) return { nivel: "profundo", motivo: "pedido longo" };

  // Baratos de reconhecer e caros de errar.
  if (SAUDACAO.test(texto)) return { nivel: "rapido", motivo: "saudação" };
  if (IMPERATIVO_DE_MAQUINA.test(texto)) {
    return { nivel: "rapido", motivo: "imperativo de máquina" };
  }
  if (palavras.length <= 5) return { nivel: "rapido", motivo: "pedido curto" };

  // Duas ou mais incógnitas numa frase só.
  const interrogativos = (texto.match(/\b(qual|quais|quando|onde|quem|quanto|como|que)\b/g) ?? []).length;
  if (interrogativos >= 2 || /\b(e tambem|alem disso|primeiro.*depois)\b/.test(texto)) {
    return { nivel: "profundo", motivo: "mais de uma incógnita" };
  }

  return { nivel: "rapido", motivo: "padrão" };
}
