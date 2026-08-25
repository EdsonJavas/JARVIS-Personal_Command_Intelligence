/**
 * Interpretação de quando algo deve acontecer, em português do Brasil.
 *
 * O modelo poderia devolver uma data ISO pronta, e é o caminho preferido — mas
 * ele erra data com frequência, principalmente "amanhã" e "sexta que vem",
 * porque não tem relógio. Então: o que vier em ISO é aceito e conferido; o que
 * vier em linguagem natural é resolvido AQUI, contra o relógio do servidor, que
 * é o mesmo relógio da máquina do dono.
 *
 * Tudo é função pura sobre um `agora` recebido — nada lê `Date.now()` por dentro.
 * Sem isso não haveria como testar "amanhã" sem esperar amanhecer.
 */

export type Interpretacao =
  | { ok: true; quando: Date }
  | { ok: false; motivo: string };

/** Chaves sem acento: a comparação sempre acontece sobre texto normalizado. */
const DIAS_DA_SEMANA: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
};

const MESES: Record<string, number> = {
  janeiro: 0, fevereiro: 1, marco: 2, abril: 3, maio: 4, junho: 5,
  julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
};

/** Horário padrão de um compromisso marcado só por dia. */
const HORA_PADRAO = 9 * 60;

/**
 * Minúsculas, sem acento, espaços colapsados.
 *
 * Tirar o acento não é capricho: o `\b` do JavaScript se baseia em
 * [A-Za-z0-9_], e "ã" não entra nisso — `/amanhã\b/` NUNCA casa com "amanhã ",
 * porque não existe fronteira entre dois caracteres não-palavra. Comparar sem
 * acento é o que faz "amanhã", "terça" e "março" serem reconhecidos.
 */
function normalizar(texto: string): string {
  return String(texto ?? "")
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Constrói uma data local a partir de um deslocamento em dias e um horário. */
function em(base: Date, diasAFrente: number, minutosDoDia: number): Date {
  const data = new Date(base);
  data.setDate(data.getDate() + diasAFrente);
  data.setHours(Math.floor(minutosDoDia / 60), minutosDoDia % 60, 0, 0);
  return data;
}

/**
 * Extrai o horário do texto. Devolve minutos desde a meia-noite.
 *
 * Aceita "15h", "15:30", "15h30", "às 9", "8 da noite", "meio-dia". O período
 * importa: "me lembre às 8 da noite" resolvido como 8h da manhã seria um
 * lembrete doze horas errado, e o dono só descobriria quando não tocasse.
 */
export function extrairHorario(texto: string): number | null {
  const t = normalizar(texto);

  if (/meio[- ]dia/.test(t)) return 12 * 60;
  if (/meia[- ]noite/.test(t)) return 0;

  // Com marcador ("15h", "15:30"), ou nu depois de "às" ("às 8 da noite").
  const comMarcador = t.match(/(\d{1,2})\s*(?::|h|hs|horas?)\s*(\d{1,2})?/);
  const nu = t.match(/\bas\s+(\d{1,2})\b/);

  let hora: number;
  let minuto: number;

  if (comMarcador) {
    hora = Number(comMarcador[1]);
    minuto = Number(comMarcador[2] ?? 0);
  } else if (nu) {
    hora = Number(nu[1]);
    minuto = 0;
  } else {
    return null;
  }

  if (hora > 23 || minuto > 59) return null;

  const daNoite = /(da noite|da tarde|\bpm\b)/.test(t);
  const daManha = /(da manha|\bam\b)/.test(t);

  if (daNoite && hora < 12) hora += 12;
  if (daManha && hora === 12) hora = 0;

  return hora * 60 + minuto;
}

/** Encontra dia e mês escritos de qualquer das formas usuais. */
function extrairData(
  t: string,
  agora: Date
): { dia: number; mes: number; ano: number | null } | null {
  const barra = t.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?/);
  if (barra) {
    const ano = barra[3] ? Number(barra[3].length === 2 ? `20${barra[3]}` : barra[3]) : null;
    return { dia: Number(barra[1]), mes: Number(barra[2]) - 1, ano };
  }

  const extenso = t.match(/\b(\d{1,2})\s+de\s+([a-z]+)/);
  if (extenso && MESES[extenso[2]] !== undefined) {
    return { dia: Number(extenso[1]), mes: MESES[extenso[2]], ano: null };
  }

  const soDia = t.match(/\bdia\s+(\d{1,2})\b/);
  if (soDia) return { dia: Number(soDia[1]), mes: agora.getMonth(), ano: null };

  return null;
}

/**
 * Resolve uma expressão de tempo contra o relógio.
 *
 * A ORDEM das tentativas é o que faz funcionar. O reconhecimento de horário
 * solto ("às 9h" = hoje) vem por ÚLTIMO, depois de dia da semana e data:
 * colocado antes, ele engolia "na sexta às 9h" e "3 de setembro às 8h",
 * devolvendo hoje ou amanhã — um compromisso da semana que vem virava um de
 * hoje à noite, sem erro nenhum aparecer.
 */
export function interpretarQuando(expressao: string, agora: Date): Interpretacao {
  const bruto = String(expressao ?? "").trim();
  if (!bruto) return { ok: false, motivo: "não veio nenhuma indicação de quando" };

  // 1) ISO pronto. É o caminho preferido quando o modelo acerta.
  if (/^\d{4}-\d{2}-\d{2}/.test(bruto)) {
    const iso = new Date(bruto);
    if (Number.isNaN(iso.getTime())) return { ok: false, motivo: "essa data não existe" };
    if (iso.getTime() <= agora.getTime()) return { ok: false, motivo: "esse instante já passou" };
    return { ok: true, quando: iso };
  }

  const t = normalizar(bruto);
  const horario = extrairHorario(t);

  // 2) Duração relativa: "em 20 minutos", "daqui a 2 horas".
  const rel = t.match(/\b(?:em|daqui a|dentro de)\s+(\d{1,4})\s*(min|minutos?|h|horas?|dias?)\b/);
  if (rel) {
    const quantidade = Number(rel[1]);
    const quando = new Date(agora);
    if (/^min/.test(rel[2])) quando.setMinutes(quando.getMinutes() + quantidade);
    else if (/^h/.test(rel[2])) quando.setHours(quando.getHours() + quantidade);
    else quando.setDate(quando.getDate() + quantidade);
    return { ok: true, quando };
  }

  // 3) Dia nomeado. "depois de amanhã" vem antes, senão "amanhã" o engole.
  if (/depois de amanha/.test(t)) return { ok: true, quando: em(agora, 2, horario ?? HORA_PADRAO) };
  if (/amanha/.test(t)) return { ok: true, quando: em(agora, 1, horario ?? HORA_PADRAO) };

  // 4) Dia da semana: "na sexta", "sexta que vem".
  for (const [nome, indice] of Object.entries(DIAS_DA_SEMANA)) {
    if (!new RegExp(`\\b${nome}\\b`).test(t)) continue;
    let diferenca = (indice - agora.getDay() + 7) % 7;
    // "quarta" numa quarta significa a próxima, não daqui a zero dias.
    if (diferenca === 0) diferenca = 7;
    return { ok: true, quando: em(agora, diferenca, horario ?? HORA_PADRAO) };
  }

  // 5) Data explícita.
  const data = extrairData(t, agora);
  if (data) {
    const minutos = horario ?? HORA_PADRAO;
    const quando = new Date(agora);
    quando.setFullYear(data.ano ?? agora.getFullYear(), data.mes, data.dia);
    quando.setHours(Math.floor(minutos / 60), minutos % 60, 0, 0);

    // Sem ano dito e data já passada: é o ano que vem. "dia 3 de janeiro", dito
    // em agosto, não é um lembrete para sete meses atrás.
    if (data.ano === null && quando.getTime() <= agora.getTime()) {
      quando.setFullYear(quando.getFullYear() + 1);
    }
    if (quando.getTime() <= agora.getTime()) return { ok: false, motivo: "essa data já passou" };
    return { ok: true, quando };
  }

  // 6) Só um horário, ou "hoje". Por último, de propósito.
  if (horario !== null) {
    const candidato = em(agora, 0, horario);
    if (candidato.getTime() > agora.getTime()) return { ok: true, quando: candidato };
    if (/\bhoje\b/.test(t)) return { ok: false, motivo: "esse horário de hoje já passou" };
    // Pedir "às 8h" às 22h não é pedir um lembrete para catorze horas atrás.
    return { ok: true, quando: em(agora, 1, horario) };
  }

  return { ok: false, motivo: `não entendi "${bruto}" como um momento` };
}

/** Escreve o instante do jeito que o Jarvis fala. */
export function descreverQuando(quando: Date, agora: Date): string {
  const minutos = Math.round((quando.getTime() - agora.getTime()) / 60000);
  if (minutos < 1) return "agora";
  if (minutos < 60) return `em ${minutos} minuto${minutos > 1 ? "s" : ""}`;

  const hora = quando.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (quando.toDateString() === agora.toDateString()) return `hoje às ${hora}`;

  const amanha = new Date(agora);
  amanha.setDate(amanha.getDate() + 1);
  if (quando.toDateString() === amanha.toDateString()) return `amanhã às ${hora}`;

  const dia = quando.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
  return `${dia}, às ${hora}`;
}
