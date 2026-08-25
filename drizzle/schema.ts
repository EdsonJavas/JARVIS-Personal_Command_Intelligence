import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Tabela de usuários que sustenta o fluxo de autenticação local.
 * Estenda este arquivo conforme o produto crescer.
 */
export const users = sqliteTable("users", {
  /** Chave primária numérica, gerenciada pelo banco. Use em relações. */
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Identificador lógico do usuário. O dono da instalação usa "owner". */
  openId: text("openId").notNull().unique(),
  name: text("name"),
  email: text("email"),
  loginMethod: text("loginMethod"),
  role: text("role", { enum: ["user", "admin"] })
    .default("user")
    .notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updatedAt", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  lastSignedIn: integer("lastSignedIn", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * O que o Jarvis aprendeu sobre o dono.
 *
 * `chave` é o assunto normalizado e serve de identidade: lembrar de novo sobre
 * o mesmo assunto ATUALIZA em vez de acumular contradição. `versao` cresce a
 * cada atualização, e o conteúdo anterior vai para o histórico — é o que
 * permite desfazer um aprendizado errado.
 */
export const memorias = sqliteTable("memorias", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  chave: text("chave").notNull().unique(),
  conteudo: text("conteudo").notNull(),
  /** fato | preferencia | projeto | correcao */
  tipo: text("tipo", { enum: ["fato", "preferencia", "projeto", "correcao"] })
    .notNull()
    .default("fato"),
  /** explicita = o dono mandou lembrar; inferida = o Jarvis deduziu. */
  origem: text("origem", { enum: ["explicita", "inferida"] })
    .notNull()
    .default("explicita"),
  /** Fixada entra no contexto sempre, sem disputar relevância. */
  fixada: integer("fixada", { mode: "boolean" }).notNull().default(false),
  versao: integer("versao").notNull().default(1),
  /** Contagem de uso: memória útil sobe na disputa por espaço. */
  usos: integer("usos").notNull().default(0),
  /** Esquecer é reversível: marca em vez de apagar. */
  esquecida: integer("esquecida", { mode: "boolean" }).notNull().default(false),
  expiraEm: integer("expiraEm", { mode: "timestamp" }),
  criadaEm: integer("criadaEm", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  atualizadaEm: integer("atualizadaEm", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** Versões anteriores de cada memória, para desfazer aprendizado errado. */
export const memoriaHistorico = sqliteTable("memoria_historico", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  memoriaId: integer("memoriaId").notNull(),
  conteudo: text("conteudo").notNull(),
  versao: integer("versao").notNull(),
  motivo: text("motivo"),
  criadoEm: integer("criadoEm", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Memoria = typeof memorias.$inferSelect;
export type InsertMemoria = typeof memorias.$inferInsert;

// TODO: adicione novas tabelas aqui

/**
 * Compromissos: o que dá ao Jarvis noção de tempo e iniciativa.
 *
 * Sem esta tabela ele só reage — você fala, ele responde, e some. Aqui moram as
 * três formas de ele te procurar sozinho:
 *
 * - `lembrete`: dispara uma vez, num instante marcado.
 * - `rotina`: repete todo dia, ou em dias da semana escolhidos, num horário.
 * - `vigia`: observa um número da máquina e avisa quando cruza um limite.
 */
export const compromissos = sqliteTable("compromissos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tipo: text("tipo", { enum: ["lembrete", "rotina", "vigia"] }).notNull(),
  /** O que ele vai dizer quando disparar. Primeira pessoa, já pronto para a voz. */
  texto: text("texto").notNull(),

  /** Quando dispara (lembrete e rotina). Para vigia fica nulo. */
  proximaEm: integer("proximaEm", { mode: "timestamp" }),
  /** Rotina: minutos desde a meia-noite, hora local. */
  horaDoDia: integer("horaDoDia"),
  /** Rotina: dias da semana, "0,1,2..." com domingo em zero. Vazio = todo dia. */
  diasDaSemana: text("diasDaSemana"),

  /** Vigia: qual número observar. */
  metrica: text("metrica", {
    enum: ["cpu", "memoria", "disco", "bateria", "temperatura"],
  }),
  /** Vigia: dispara quando a métrica passa (acima) ou cai abaixo do limite. */
  comparacao: text("comparacao", { enum: ["acima", "abaixo"] }),
  limite: integer("limite"),
  /**
   * Vigia: já está disparado?
   *
   * Sem esta trava, um disco a 91% avisaria a cada volta do relógio. Só volta a
   * armar quando a métrica retorna ao normal.
   */
  armado: integer("armado", { mode: "boolean" }).notNull().default(true),

  ativo: integer("ativo", { mode: "boolean" }).notNull().default(true),
  ultimoDisparoEm: integer("ultimoDisparoEm", { mode: "timestamp" }),
  disparos: integer("disparos").notNull().default(0),
  criadoEm: integer("criadoEm", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Compromisso = typeof compromissos.$inferSelect;
