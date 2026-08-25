import { and, desc, eq } from "drizzle-orm";
import type { Memoria } from "../../drizzle/schema";
import { memoriaHistorico, memorias } from "../../drizzle/schema";
import { ensureSchema, filaDeEscrita, getDb } from "../db";
import { inspecionarSegredo } from "./filtroDeSegredos";
import { acharParecida, chaveDoAssunto } from "./relevancia";

/**
 * Persistência das memórias.
 *
 * Toda escrita passa pela fila do banco e pelo filtro de segredos. Atualizar uma
 * memória guarda a versão anterior no histórico ANTES de sobrescrever — é o que
 * permite desfazer um aprendizado errado.
 */

export type ResultadoDeLembranca =
  | { estado: "criada"; memoria: Memoria }
  | { estado: "atualizada"; memoria: Memoria; anterior: string }
  | { estado: "parecida"; memoria: Memoria; existente: Memoria }
  | { estado: "bloqueada"; categoria: string; motivo: string };

export type EntradaDeLembranca = {
  conteudo: string;
  tipo?: "fato" | "preferencia" | "projeto" | "correcao";
  origem?: "explicita" | "inferida";
  fixada?: boolean;
  expiraEm?: Date | null;
};

export async function listarMemorias(incluirEsquecidas = false): Promise<Memoria[]> {
  // Toda entrada do repositório espera as migrações: sem isto, a primeira
  // chamada antes de qualquer login encontraria o banco sem as tabelas.
  await ensureSchema();
  const db = getDb();
  const linhas = await db.select().from(memorias).orderBy(desc(memorias.atualizadaEm));
  return incluirEsquecidas ? linhas : linhas.filter((linha) => !linha.esquecida);
}

export async function lembrar(entrada: EntradaDeLembranca): Promise<ResultadoDeLembranca> {
  const conteudo = String(entrada.conteudo ?? "").trim();
  if (!conteudo) {
    return { estado: "bloqueada", categoria: "vazio", motivo: "não havia conteúdo para lembrar" };
  }

  const veredito = inspecionarSegredo(conteudo);
  if (!veredito.permitido) {
    // O que não deve existir não chega a ser gravado.
    return { estado: "bloqueada", categoria: veredito.categoria, motivo: veredito.motivo };
  }

  const chave = chaveDoAssunto(conteudo);
  const existentes = await listarMemorias(true);

  /*
   * A identidade não pode depender só da chave derivada dos tokens: "mora em
   * Marília, São Paulo" e "mora em Marília, interior de São Paulo" geram chaves
   * diferentes por uma palavra, e o resultado seriam duas memórias
   * contraditórias sobre o mesmo assunto. Quando o conteúdo é parecido o
   * bastante, ATUALIZA a existente.
   */
  const mesmaChave =
    existentes.find((memoria) => memoria.chave === chave) ??
    acharParecida(existentes, conteudo) ??
    undefined;

  return filaDeEscrita(async () => {
    const db = getDb();
    const agora = new Date();

    if (mesmaChave) {
      // Memória inferida não sobrescreve o que o dono afirmou explicitamente.
      if (mesmaChave.origem === "explicita" && (entrada.origem ?? "explicita") === "inferida") {
        return { estado: "parecida", memoria: mesmaChave, existente: mesmaChave } as const;
      }

      // O histórico é gravado ANTES da substituição: falhar depois deixaria a
      // memória trocada sem registro do que havia antes.
      await db.insert(memoriaHistorico).values({
        memoriaId: mesmaChave.id,
        conteudo: mesmaChave.conteudo,
        versao: mesmaChave.versao,
        motivo: "atualizada",
      });

      await db
        .update(memorias)
        .set({
          conteudo,
          tipo: entrada.tipo ?? mesmaChave.tipo,
          origem: entrada.origem ?? mesmaChave.origem,
          fixada: entrada.fixada ?? mesmaChave.fixada,
          expiraEm: entrada.expiraEm ?? mesmaChave.expiraEm,
          versao: mesmaChave.versao + 1,
          esquecida: false,
          atualizadaEm: agora,
        })
        .where(eq(memorias.id, mesmaChave.id));

      const [atualizada] = await db
        .select()
        .from(memorias)
        .where(eq(memorias.id, mesmaChave.id))
        .limit(1);

      return {
        estado: "atualizada",
        memoria: atualizada,
        anterior: mesmaChave.conteudo,
      } as const;
    }

    // Assunto diferente mas conteúdo muito parecido: grava e avisa, para o
    // Jarvis poder perguntar qual vale.
    const parecida = acharParecida(existentes, conteudo);

    await db.insert(memorias).values({
      chave,
      conteudo,
      tipo: entrada.tipo ?? "fato",
      origem: entrada.origem ?? "explicita",
      fixada: entrada.fixada ?? false,
      expiraEm: entrada.expiraEm ?? null,
      criadaEm: agora,
      atualizadaEm: agora,
    });

    const [criada] = await db
      .select()
      .from(memorias)
      .where(eq(memorias.chave, chave))
      .limit(1);

    if (parecida) {
      return { estado: "parecida", memoria: criada, existente: parecida } as const;
    }
    return { estado: "criada", memoria: criada } as const;
  });
}

/** Esquecer é reversível: marca em vez de apagar. */
export async function esquecer(id: number, motivo = "pedido do dono"): Promise<boolean> {
  await ensureSchema();
  return filaDeEscrita(async () => {
    const db = getDb();
    const [memoria] = await db.select().from(memorias).where(eq(memorias.id, id)).limit(1);
    if (!memoria) return false;

    await db.insert(memoriaHistorico).values({
      memoriaId: memoria.id,
      conteudo: memoria.conteudo,
      versao: memoria.versao,
      motivo,
    });
    await db
      .update(memorias)
      .set({ esquecida: true, atualizadaEm: new Date() })
      .where(eq(memorias.id, id));

    return true;
  });
}

export async function restaurar(id: number): Promise<boolean> {
  await ensureSchema();
  return filaDeEscrita(async () => {
    const db = getDb();

    // Confere a linha ANTES de escrever. O retorno do update é um objeto mesmo
    // quando nada casou, então `Boolean(resultado)` era sempre verdadeiro: a
    // função dizia ter restaurado id inexistente e memória que nunca fora
    // esquecida.
    const [memoria] = await db
      .select()
      .from(memorias)
      .where(and(eq(memorias.id, id), eq(memorias.esquecida, true)))
      .limit(1);
    if (!memoria) return false;

    await db
      .update(memorias)
      .set({ esquecida: false, atualizadaEm: new Date() })
      .where(eq(memorias.id, id));

    return true;
  });
}

/** Marca que estas memórias foram usadas: as úteis sobem na disputa. */
export async function registrarUso(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  await ensureSchema();
  await filaDeEscrita(async () => {
    const db = getDb();
    for (const id of ids) {
      const [memoria] = await db.select().from(memorias).where(eq(memorias.id, id)).limit(1);
      if (!memoria) continue;
      await db
        .update(memorias)
        .set({ usos: (memoria.usos ?? 0) + 1 })
        .where(eq(memorias.id, id));
    }
  });
}

export async function historicoDe(id: number) {
  await ensureSchema();
  return getDb()
    .select()
    .from(memoriaHistorico)
    .where(eq(memoriaHistorico.memoriaId, id))
    .orderBy(desc(memoriaHistorico.versao));
}
