import type { AcaoJarvis } from "@shared/jarvisStream";

/**
 * O que um turno ensinou.
 *
 * O dono foi direto: ele DEVE aprender com ele mesmo, sempre. Não só quando
 * mandam guardar. Cada turno deixa sinais que valem para os seguintes — um
 * caminho que falhou e outro que funcionou, uma correção do dono, uma
 * preferência dita de passagem — e sem alguém olhando para eles ao fim do
 * turno, morrem com a conversa.
 *
 * Isto é a leitura barata desses sinais: sem chamada ao modelo, porque cada
 * chamada gasta cota e a cota é o recurso mais escasso que existe aqui. O que
 * exige entendimento fica com a ferramenta `lembrar`, que o modelo chama por
 * conta própria; isto pega o que dá para pegar olhando a forma.
 */

export type Licao = {
  conteudo: string;
  tipo: "correcao" | "preferencia" | "fato";
};

type Fala = { role: "user" | "assistant"; content: string };

const MIN = 12;
const MAX = 220;

/**
 * O dono corrigindo o assistente.
 *
 * Não é qualquer "não": é "não" no começo da fala, ou um verbo de correção,
 * logo depois de uma resposta dele. O resto da frase é o que vale guardar,
 * porque é onde está o que ele queria.
 */
const CORRECAO =
  /^(n[aã]o[,.!]?\s+(?:era|é|e|foi|quero|quis|assim|isso|desse|dessa)|n[aã]o é isso|errado|errou|t[aá] errado|eu disse|eu pedi|de novo n[aã]o|para de|pare de|nunca mais)/i;

/** Preferência dita de passagem, em qualquer ponto da fala. */
const PREFERENCIA =
  /\b(sempre|nunca|prefiro|n[aã]o gosto|gosto mais|odeio|detesto|a partir de agora|de agora em diante|daqui pra frente|obrigatoriamente|apenas|somente)\b/i;

function limpar(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

function frase(texto: string): string | null {
  const t = limpar(texto);
  if (t.length < MIN) return null;
  return t.length > MAX ? `${t.slice(0, MAX - 1)}…` : t;
}

/** Uma correção vira lição com o contexto do que foi corrigido. */
function licaoDeCorrecao(anterior: string, correcao: string): Licao | null {
  const conteudo = frase(correcao);
  if (!conteudo) return null;
  const contexto = limpar(anterior).slice(0, 90);
  return {
    tipo: "correcao",
    conteudo: contexto
      ? `Corrigido pelo dono: "${conteudo}" (depois de eu dizer "${contexto}${limpar(anterior).length > 90 ? "…" : ""}").`
      : `Corrigido pelo dono: "${conteudo}".`,
  };
}

/**
 * Ferramenta que falhou e outra que resolveu em seguida, no mesmo turno.
 *
 * Só quando há as duas: falha sozinha não ensina caminho nenhum, e sucesso
 * sozinho é o normal. O par é o que diz "da próxima vez, vá direto no segundo".
 */
function licoesDeCaminho(acoes: AcaoJarvis[]): Licao[] {
  const licoes: Licao[] = [];
  for (let i = 0; i < acoes.length; i += 1) {
    const falhou = acoes[i];
    if (falhou.ok) continue;
    const resolveu = acoes.slice(i + 1).find((a) => a.ok && a.name !== falhou.name);
    if (!resolveu) continue;
    const motivo = limpar(String(falhou.resumo ?? "")).slice(0, 80);
    licoes.push({
      tipo: "fato",
      conteudo:
        `Quando ${falhou.name} falha${motivo ? ` ("${motivo}")` : ""}, ` +
        `${resolveu.name} resolveu no lugar. Da próxima vez, ir direto.`,
    });
    break; // uma por turno basta; várias iguais viram ruído
  }
  return licoes;
}

export function refletir(mensagens: Fala[], acoes: AcaoJarvis[] = []): Licao[] {
  const licoes: Licao[] = [];

  // Só a última fala do dono é deste turno; as anteriores já foram lidas antes.
  const indice = [...mensagens].map((m) => m.role).lastIndexOf("user");
  if (indice === -1) return licoesDeCaminho(acoes);

  const fala = mensagens[indice].content;
  const anterior = mensagens
    .slice(0, indice)
    .reverse()
    .find((m) => m.role === "assistant")?.content;

  if (anterior && CORRECAO.test(limpar(fala))) {
    const licao = licaoDeCorrecao(anterior, fala);
    if (licao) licoes.push(licao);
  } else if (PREFERENCIA.test(fala)) {
    const conteudo = frase(fala);
    if (conteudo) licoes.push({ tipo: "preferencia", conteudo: `O dono disse: "${conteudo}"` });
  }

  licoes.push(...licoesDeCaminho(acoes));
  return licoes;
}
