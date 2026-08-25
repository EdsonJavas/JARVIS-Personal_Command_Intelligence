import { and, asc, eq } from "drizzle-orm";
import { compromissos, type Compromisso } from "../../drizzle/schema";
import { ensureSchema, filaDeEscrita, getDb } from "../db";
import { interpretarQuando } from "./quando";

/**
 * Persistência dos compromissos: o que o Jarvis promete fazer sozinho.
 *
 * Tudo o que decide horário é função pura sobre um `agora` recebido, pelo mesmo
 * motivo do interpretador: sem isso não haveria como testar "a rotina das 8h
 * dispara amanhã" sem esperar amanhecer.
 */

export type NovoLembrete = { texto: string; quando: string };
export type NovaRotina = { texto: string; horaDoDia: number; diasDaSemana?: number[] };
export type NovoVigia = {
  texto: string;
  metrica: "cpu" | "memoria" | "disco" | "bateria" | "temperatura";
  comparacao: "acima" | "abaixo";
  limite: number;
};

export type ResultadoDeCriacao =
  | { ok: true; compromisso: Compromisso }
  | { ok: false; motivo: string };

/**
 * Próximo disparo de uma rotina.
 *
 * Hoje, se o horário ainda não passou e o dia da semana serve; senão, o próximo
 * dia válido. A busca varre no máximo oito dias — sete cobre qualquer conjunto
 * de dias da semana, e o oitavo é a folga que evita laço infinito caso a lista
 * chegue vazia por dado corrompido.
 */
export function proximaDaRotina(
  horaDoDia: number,
  diasDaSemana: number[],
  agora: Date
): Date | null {
  for (let adiante = 0; adiante <= 8; adiante += 1) {
    const candidato = new Date(agora);
    candidato.setDate(candidato.getDate() + adiante);
    candidato.setHours(Math.floor(horaDoDia / 60), horaDoDia % 60, 0, 0);

    if (candidato.getTime() <= agora.getTime()) continue;
    if (diasDaSemana.length > 0 && !diasDaSemana.includes(candidato.getDay())) continue;
    return candidato;
  }
  return null;
}

function listaDeDias(compromisso: Compromisso): number[] {
  if (!compromisso.diasDaSemana) return [];
  return compromisso.diasDaSemana
    .split(",")
    .map((parte) => Number(parte.trim()))
    .filter((dia) => Number.isInteger(dia) && dia >= 0 && dia <= 6);
}

export async function listarCompromissos(incluirInativos = false): Promise<Compromisso[]> {
  // Toda entrada espera as migrações: sem isto, a primeira chamada numa máquina
  // limpa encontraria o banco sem a tabela.
  await ensureSchema();
  const linhas = await getDb().select().from(compromissos).orderBy(asc(compromissos.proximaEm));
  return incluirInativos ? linhas : linhas.filter((linha) => linha.ativo);
}

export async function criarLembrete(
  entrada: NovoLembrete,
  agora = new Date()
): Promise<ResultadoDeCriacao> {
  const texto = String(entrada.texto ?? "").trim();
  if (!texto) return { ok: false, motivo: "não disse o que era para lembrar" };

  const interpretacao = interpretarQuando(entrada.quando, agora);
  if (!interpretacao.ok) return { ok: false, motivo: interpretacao.motivo };

  return gravar({
    tipo: "lembrete",
    texto,
    proximaEm: interpretacao.quando,
  });
}

export async function criarRotina(entrada: NovaRotina): Promise<ResultadoDeCriacao> {
  const texto = String(entrada.texto ?? "").trim();
  if (!texto) return { ok: false, motivo: "não disse o que era para fazer na rotina" };

  const hora = Number(entrada.horaDoDia);
  if (!Number.isInteger(hora) || hora < 0 || hora > 24 * 60 - 1) {
    return { ok: false, motivo: "o horário da rotina está fora do dia" };
  }

  const dias = (entrada.diasDaSemana ?? []).filter(
    (dia) => Number.isInteger(dia) && dia >= 0 && dia <= 6
  );

  const proxima = proximaDaRotina(hora, dias, new Date());
  if (!proxima) return { ok: false, motivo: "essa combinação de dias nunca acontece" };

  return gravar({
    tipo: "rotina",
    texto,
    proximaEm: proxima,
    horaDoDia: hora,
    diasDaSemana: dias.length > 0 ? dias.join(",") : null,
  });
}

export async function criarVigia(entrada: NovoVigia): Promise<ResultadoDeCriacao> {
  const texto = String(entrada.texto ?? "").trim();
  if (!texto) return { ok: false, motivo: "não disse o que avisar" };

  const limite = Number(entrada.limite);
  if (!Number.isFinite(limite)) return { ok: false, motivo: "o limite não é um número" };

  return gravar({
    tipo: "vigia",
    texto,
    metrica: entrada.metrica,
    comparacao: entrada.comparacao,
    limite: Math.round(limite),
  });
}

async function gravar(valores: Record<string, unknown>): Promise<ResultadoDeCriacao> {
  await ensureSchema();
  return filaDeEscrita(async () => {
    const db = getDb();
    const agora = new Date();
    await db.insert(compromissos).values({ ...valores, criadoEm: agora } as never);

    // Recupera pelo mais recente: o libsql não devolve a linha inserida.
    const [criado] = await db
      .select()
      .from(compromissos)
      .orderBy(asc(compromissos.id))
      .then((linhas) => linhas.slice(-1));

    return { ok: true, compromisso: criado } as const;
  });
}

export async function cancelarCompromisso(id: number): Promise<boolean> {
  await ensureSchema();
  return filaDeEscrita(async () => {
    const db = getDb();
    // Confere antes de escrever: o update devolve objeto mesmo sem casar linha,
    // e sem esta leitura a função diria ter cancelado o que não existe.
    const [alvo] = await db
      .select()
      .from(compromissos)
      .where(and(eq(compromissos.id, id), eq(compromissos.ativo, true)))
      .limit(1);
    if (!alvo) return false;

    await db.update(compromissos).set({ ativo: false }).where(eq(compromissos.id, id));
    return true;
  });
}

/**
 * Marca que um compromisso disparou e calcula o próximo.
 *
 * Lembrete morre depois de tocar. Rotina reagenda. Vigia continua ativo, mas
 * desarmado — só volta a avisar quando a métrica normalizar, senão um disco a
 * 91% avisaria a cada volta do relógio.
 */
export async function registrarDisparo(compromisso: Compromisso, agora = new Date()): Promise<void> {
  await ensureSchema();
  await filaDeEscrita(async () => {
    const db = getDb();
    const comum = {
      ultimoDisparoEm: agora,
      disparos: (compromisso.disparos ?? 0) + 1,
    };

    if (compromisso.tipo === "lembrete") {
      await db
        .update(compromissos)
        .set({ ...comum, ativo: false, proximaEm: null })
        .where(eq(compromissos.id, compromisso.id));
      return;
    }

    if (compromisso.tipo === "rotina") {
      const proxima = proximaDaRotina(
        compromisso.horaDoDia ?? 0,
        listaDeDias(compromisso),
        // Parte de um minuto à frente para não reagendar no mesmo instante.
        new Date(agora.getTime() + 60_000)
      );
      await db
        .update(compromissos)
        .set({ ...comum, proximaEm: proxima })
        .where(eq(compromissos.id, compromisso.id));
      return;
    }

    await db
      .update(compromissos)
      .set({ ...comum, armado: false })
      .where(eq(compromissos.id, compromisso.id));
  });
}

/** Rearma um vigia quando a métrica voltou ao normal. */
export async function rearmarVigia(id: number): Promise<void> {
  await ensureSchema();
  await filaDeEscrita(async () => {
    await getDb().update(compromissos).set({ armado: true }).where(eq(compromissos.id, id));
  });
}

/**
 * O vigia deve disparar com esta leitura?
 *
 * Separado do resto por ser a decisão que mais erra na prática, e a única que
 * depende de um número que muda sozinho a cada segundo.
 */
export function vigiaDispara(compromisso: Compromisso, valor: number | null): boolean {
  if (valor === null || compromisso.limite === null) return false;
  if (!compromisso.armado) return false;
  return compromisso.comparacao === "acima"
    ? valor > compromisso.limite
    : valor < compromisso.limite;
}

/** O vigia voltou ao normal e pode ser rearmado? */
export function vigiaNormalizou(compromisso: Compromisso, valor: number | null): boolean {
  if (valor === null || compromisso.limite === null) return false;
  if (compromisso.armado) return false;

  /*
   * A folga de 5 evita o tremor: um disco oscilando entre 89% e 91% avisaria,
   * rearmaria e avisaria de novo sem parar. Só rearma quando de fato afastou.
   */
  const FOLGA = 5;
  return compromisso.comparacao === "acima"
    ? valor < compromisso.limite - FOLGA
    : valor > compromisso.limite + FOLGA;
}
