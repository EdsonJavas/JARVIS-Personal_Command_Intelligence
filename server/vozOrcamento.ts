import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Controle do teto diário da síntese neural.
 *
 * O plano gratuito do Gemini dá DEZ requisições por dia para o modelo de voz.
 * Isso muda o desenho inteiro: a fala neural deixa de ser o caminho normal e
 * passa a ser um recurso escasso, gasto onde faz mais diferença.
 *
 * Sem esta contagem, cada tentativa depois do teto ainda pagava a ida à rede
 * para receber um 429 — segundos de espera antes de cair para a voz do sistema,
 * bem no meio da conversa. Sabendo o saldo, a queda é imediata.
 *
 * A contagem vive em disco porque o servidor reinicia a cada salvamento durante
 * o desenvolvimento, e um contador em memória zeraria junto, fazendo o Jarvis
 * insistir numa cota que já acabou.
 */

const PASTA_DADOS = process.env.JARVIS_DATA_DIR?.trim() || "data";
const ARQUIVO = resolve(process.cwd(), PASTA_DADOS, "voz", "orcamento.json");

/** Teto do plano gratuito. Configurável para quem ativar cobrança na conta. */
const LIMITE_DIARIO = Number(process.env.TTS_LIMITE_DIARIO ?? 10);

/**
 * Reserva para a RESPOSTA final.
 *
 * O anúncio de ação sai de frases fixas, que ficam em cache para sempre depois
 * da primeira vez. A resposta é sempre texto novo e nunca terá cache — é ela
 * que precisa da voz boa, e é ela que o dono de fato escuta até o fim.
 */
const RESERVA_PARA_RESPOSTA = 4;

type Contagem = { dia: string; gastas: number };

/** Dia local, não UTC: o teto da Google vira à meia-noite do fuso do projeto. */
function hoje(): string {
  return new Date().toLocaleDateString("sv-SE");
}

function ler(): Contagem {
  try {
    const dados = JSON.parse(readFileSync(ARQUIVO, "utf8")) as Contagem;
    if (dados?.dia === hoje()) return dados;
  } catch {
    /* ainda não existe */
  }
  return { dia: hoje(), gastas: 0 };
}

function gravar(contagem: Contagem): void {
  try {
    mkdirSync(dirname(ARQUIVO), { recursive: true });
    writeFileSync(ARQUIVO, JSON.stringify(contagem), "utf8");
  } catch {
    /* sem disco, a contagem vale só para este processo */
  }
}

export type Prioridade = "resposta" | "anuncio";

export function saldo(): { gastas: number; limite: number; restam: number } {
  const contagem = ler();
  return {
    gastas: contagem.gastas,
    limite: LIMITE_DIARIO,
    restam: Math.max(0, LIMITE_DIARIO - contagem.gastas),
  };
}

/**
 * Ainda cabe uma síntese desta prioridade?
 *
 * Anúncio para de gastar antes, para não comer a reserva da resposta: é melhor
 * ouvir "vou medir a máquina" na voz do sistema e o relatório na voz boa do que
 * o contrário.
 */
export function podeSintetizar(prioridade: Prioridade): boolean {
  const { restam } = saldo();
  if (prioridade === "resposta") return restam > 0;
  return restam > RESERVA_PARA_RESPOSTA;
}

export function registrarUso(): void {
  const contagem = ler();
  gravar({ dia: contagem.dia, gastas: contagem.gastas + 1 });
}

/**
 * Marca a cota como esgotada.
 *
 * Chamado quando a Google devolve 429: o teto real pode ser menor que o
 * configurado, ou a conta pode ter sido usada por fora. Vale mais a resposta do
 * provedor do que a nossa contagem.
 */
export function marcarEsgotada(): void {
  gravar({ dia: hoje(), gastas: LIMITE_DIARIO });
}
