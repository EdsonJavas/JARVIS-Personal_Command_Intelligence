import { createClient, type Client } from "@libsql/client";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { InsertUser, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _client: Client | null = null;
let _db: ReturnType<typeof drizzle> | null = null;
let _ready: Promise<void> | null = null;

/**
 * Migrações aplicadas no boot, em ordem, uma única vez cada.
 *
 * Não se usa `drizzle-kit migrate` aqui de propósito: o journal do Drizzle não
 * sabe que a tabela `users` já existe nos bancos criados antes deste controle, e
 * tentaria recriá-la.
 *
 * A migração `001` precisa ser byte a byte o CREATE TABLE que já rodava. Se
 * divergir, o boot quebra na máquina de quem já tem banco — e não numa limpa,
 * que é onde se costuma testar.
 */
const CREATE_USERS_TABLE = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  openId TEXT NOT NULL UNIQUE,
  name TEXT,
  email TEXT,
  loginMethod TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  createdAt INTEGER NOT NULL DEFAULT (unixepoch()),
  updatedAt INTEGER NOT NULL DEFAULT (unixepoch()),
  lastSignedIn INTEGER NOT NULL DEFAULT (unixepoch())
)`;

type Migracao = { nome: string; sql: string[] };

const MIGRACOES: Migracao[] = [
  {
    // WAL permite leitura durante escrita; em journal de rollback um escritor
    // tranca o banco inteiro. Com quatro escritores concorrentes, o sintoma
    // seria o login falhando enquanto outra coisa grava.
    nome: "000_pragmas",
    sql: ["PRAGMA journal_mode=WAL", "PRAGMA busy_timeout=5000"],
  },
  { nome: "001_users", sql: [CREATE_USERS_TABLE] },
  {
    nome: "002_memorias",
    sql: [
      `CREATE TABLE IF NOT EXISTS memorias (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chave TEXT NOT NULL UNIQUE,
        conteudo TEXT NOT NULL,
        tipo TEXT NOT NULL DEFAULT 'fato',
        origem TEXT NOT NULL DEFAULT 'explicita',
        fixada INTEGER NOT NULL DEFAULT 0,
        versao INTEGER NOT NULL DEFAULT 1,
        usos INTEGER NOT NULL DEFAULT 0,
        esquecida INTEGER NOT NULL DEFAULT 0,
        expiraEm INTEGER,
        criadaEm INTEGER NOT NULL DEFAULT (unixepoch()),
        atualizadaEm INTEGER NOT NULL DEFAULT (unixepoch())
      )`,
      `CREATE TABLE IF NOT EXISTS memoria_historico (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memoriaId INTEGER NOT NULL,
        conteudo TEXT NOT NULL,
        versao INTEGER NOT NULL,
        motivo TEXT,
        criadoEm INTEGER NOT NULL DEFAULT (unixepoch())
      )`,
      `CREATE INDEX IF NOT EXISTS idx_memoria_historico_memoria ON memoria_historico(memoriaId)`,
    ],
  },

  {
    nome: "003_compromissos",
    sql: [
      `CREATE TABLE IF NOT EXISTS compromissos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT NOT NULL,
        texto TEXT NOT NULL,
        proximaEm INTEGER,
        horaDoDia INTEGER,
        diasDaSemana TEXT,
        metrica TEXT,
        comparacao TEXT,
        limite INTEGER,
        armado INTEGER NOT NULL DEFAULT 1,
        ativo INTEGER NOT NULL DEFAULT 1,
        ultimoDisparoEm INTEGER,
        disparos INTEGER NOT NULL DEFAULT 0,
        criadoEm INTEGER NOT NULL DEFAULT (unixepoch())
      )`,
      // O agendador varre por "o que vence agora": sem indice, cada volta do
      // relogio faria varredura completa da tabela.
      `CREATE INDEX IF NOT EXISTS idx_compromissos_proxima ON compromissos(ativo, proximaEm)`,
    ],
  },
  {
    nome: "004_conversa",
    sql: [
      `CREATE TABLE IF NOT EXISTS conversa (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        acoes TEXT,
        criadaEm INTEGER NOT NULL DEFAULT (unixepoch())
      )`,
    ],
  },
];

const CREATE_MIGRACOES_TABLE = `
CREATE TABLE IF NOT EXISTS _migracoes (
  nome TEXT PRIMARY KEY,
  aplicadaEm INTEGER NOT NULL DEFAULT (unixepoch())
)`;

/**
 * Aceita tanto um caminho de arquivo quanto uma URL pronta, para que trocar o
 * SQLite local por um banco remoto seja só uma mudança de DATABASE_URL.
 */
function resolveDatabaseUrl(): string {
  const configurado = ENV.databaseUrl;
  if (/^(file:|libsql:|https?:|ws:|wss:)/.test(configurado)) return configurado;

  const absoluto = resolve(process.cwd(), configurado);
  mkdirSync(dirname(absoluto), { recursive: true });
  return pathToFileURL(absoluto).href;
}

function getDb() {
  if (!_db) {
    const url = resolveDatabaseUrl();
    _client = createClient({ url });
    _db = drizzle(_client);
    console.log("[Database] SQLite em", url);
  }
  return _db;
}

/** Roda as migrações pendentes. Idempotente e seguro em banco já existente. */
function ensureSchema(): Promise<void> {
  if (!_ready) {
    _ready = (async () => {
      const db = getDb();
      await db.run(sql.raw(CREATE_MIGRACOES_TABLE));

      const aplicadas = await db.all<{ nome: string }>(sql.raw("SELECT nome FROM _migracoes"));
      const jaFeitas = new Set(aplicadas.map((linha) => linha.nome));

      for (const migracao of MIGRACOES) {
        if (jaFeitas.has(migracao.nome)) continue;
        for (const comando of migracao.sql) {
          await db.run(sql.raw(comando));
        }
        await db.run(
          sql`INSERT OR IGNORE INTO _migracoes (nome) VALUES (${migracao.nome})`
        );
        console.log("[Database] migração aplicada:", migracao.nome);
      }
    })();
  }
  return _ready;
}

/**
 * Serializa toda escrita do processo.
 *
 * O banco é de um usuário só; serializar não custa nada e elimina a classe de
 * falha em que duas gravações simultâneas se atropelam. Cada tarefa entra na
 * fila mesmo que a anterior tenha falhado.
 */
let fila: Promise<unknown> = Promise.resolve();

export function filaDeEscrita<T>(tarefa: () => Promise<T>): Promise<T> {
  const proxima = fila.then(tarefa, tarefa);
  fila = proxima.catch(() => undefined);
  return proxima;
}

/** Acrescenta coluna quando ela ainda não existe, sem quebrar bancos antigos. */
export async function adicionarColunaSeFaltar(
  tabela: string,
  coluna: string,
  definicao: string
): Promise<void> {
  await ensureSchema();
  const colunas = await getDb().all<{ name: string }>(
    sql.raw(`PRAGMA table_info(${tabela})`)
  );
  if (colunas.some((linha) => linha.name === coluna)) return;
  await getDb().run(sql.raw(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`));
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("openId é obrigatório para gravar o usuário");
  }

  await ensureSchema();
  const agora = new Date();

  await filaDeEscrita(() =>
    getDb()
      .insert(users)
      .values({
        ...user,
        lastSignedIn: user.lastSignedIn ?? agora,
        updatedAt: agora,
      })
      .onConflictDoUpdate({
        target: users.openId,
        set: {
          name: user.name ?? null,
          role: user.role ?? "user",
          lastSignedIn: user.lastSignedIn ?? agora,
          updatedAt: agora,
        },
      })
  );
}

export async function getUserByOpenId(openId: string) {
  await ensureSchema();
  const resultado = await getDb()
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);

  return resultado.length > 0 ? resultado[0] : undefined;
}

/** Exposto para os testes e para quem precisar do handle direto. */
export { getDb, ensureSchema };
