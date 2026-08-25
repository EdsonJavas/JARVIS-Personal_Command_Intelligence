import type { AcaoJarvis, MensagemDeFio } from "@shared/jarvisStream";

/**
 * Como a saída de uma ferramenta vira uma frase de fato, e como o que já foi
 * executado volta ao modelo no turno seguinte.
 *
 * Sem a recapitulação, o Jarvis refaz a busca que acabou de fazer: as ações
 * ficavam só na interface e nunca chegavam ao modelo.
 */

export const TETO_DE_RECAPITULACAO = 1800;
const LIMITE_RESUMO = 160;

/**
 * Extrai o fato de uma saída de comando.
 *
 * Nove das treze ferramentas terminam em `Format-Table -AutoSize | Out-String`,
 * cuja saída começa com linha em branco, cabeçalho de colunas e uma régua de
 * hifens. Pegar "a primeira linha não vazia" devolveria `TamanhoMB Modificado
 * FullName` — cabeçalho, não resultado. Por isso as linhas de cabeçalho e régua
 * são descartadas antes.
 */
export function resumirSaida(saida: string, ok: boolean, limite = LIMITE_RESUMO): string {
  const bruto = (saida ?? "").trim();
  if (!bruto) return ok ? "sem saída" : "falhou sem mensagem";

  const linhas = bruto
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean);

  // Régua do Format-Table: só hifens e espaços.
  const ehRegua = (linha: string) => /^[-\s]+$/.test(linha);
  const indiceRegua = linhas.findIndex(ehRegua);

  // Havendo régua, o cabeçalho é a linha imediatamente anterior; o conteúdo
  // começa depois dela.
  const uteis =
    indiceRegua >= 0 ? linhas.slice(indiceRegua + 1) : linhas.filter((l) => !ehRegua(l));

  const escolhidas = uteis.length > 0 ? uteis : linhas;
  const texto = escolhidas.join(" · ").replace(/\s+/g, " ").trim();

  if (texto.length <= limite) return texto;
  return `${texto.slice(0, limite - 1).trimEnd()}…`;
}

/**
 * Erro embutido numa saída que o processo reportou como sucesso.
 *
 * Vários comandos usam `-ErrorAction SilentlyContinue` e saem com código zero
 * mesmo sem terem feito nada. Sem isto, a retentativa nunca dispara e a
 * interface pinta de verde um comando que não funcionou.
 */
const MARCAS_DE_FALHA = [
  /access is denied/i,
  /acesso negado/i,
  /objectnotfound/i,
  /cannot find path/i,
  /não foi possível encontrar o caminho/i,
  /is not recognized as/i,
  /não é reconhecido como/i,
  /permissiondenied/i,
  /unauthorizedaccess/i,
  /commandnotfound/i,
  /invalidoperation/i,
  /the system cannot find/i,
];

export function saidaIndicaFalha(saida: string): boolean {
  const texto = (saida ?? "").trim();
  if (!texto) return false;
  return MARCAS_DE_FALHA.some((marca) => marca.test(texto));
}

/**
 * Monta o bloco de recapitulação que acompanha uma fala do assistente.
 *
 * Volta ao modelo como parte do `content` da mensagem de assistente, e não como
 * papel `tool`: o histórico entre turnos não tem os `tool_call_id` originais, e
 * mensagens `tool` órfãs são recusadas pelo provedor.
 */
export function montarRecapitulacao(
  acoes: AcaoJarvis[] | undefined,
  teto = TETO_DE_RECAPITULACAO
): string {
  if (!acoes || acoes.length === 0) return "";

  const linhas: string[] = [];
  let tamanho = 0;

  // Percorre de trás para frente: sob pressão de espaço, o recente importa mais.
  for (let i = acoes.length - 1; i >= 0; i -= 1) {
    const acao = acoes[i];
    const linha = `- ${acao.name}(${acao.detail}) → ${acao.ok ? "" : "FALHOU: "}${acao.resumo}`;
    if (tamanho + linha.length > teto) break;
    linhas.unshift(linha);
    tamanho += linha.length + 1;
  }

  if (linhas.length === 0) return "";
  return `[Ações que você executou neste turno]\n${linhas.join("\n")}`;
}

const MARCA_RECAPITULACAO = "[Ações que você executou neste turno]";

/**
 * Anexa a recapitulação ao conteúdo de uma mensagem do assistente.
 *
 * Idempotente de propósito: o cliente reenvia o histórico a cada turno, e
 * aplicar duas vezes faria o bloco crescer até estourar o limite de tamanho da
 * mensagem no zod.
 */
export function comRecapitulacao(mensagem: MensagemDeFio): string {
  if (mensagem.role !== "assistant") return mensagem.content;
  if (mensagem.content.includes(MARCA_RECAPITULACAO)) return mensagem.content;

  const bloco = montarRecapitulacao(mensagem.acoes);
  if (!bloco) return mensagem.content;
  return `${mensagem.content}\n\n${bloco}`;
}
