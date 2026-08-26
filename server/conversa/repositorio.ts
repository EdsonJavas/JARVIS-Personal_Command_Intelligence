import { asc, desc } from "drizzle-orm";
import type { AcaoJarvis } from "@shared/jarvisStream";
import { conversa } from "../../drizzle/schema";
import { ensureSchema, filaDeEscrita, getDb } from "../db";

/**
 * A conversa sobrevive à aba.
 *
 * Antes, fechar a janela apagava tudo: na volta o Jarvis era outro, sem saber
 * o que tinha acabado de fazer. O dono foi direto — o do Tony não esquecia
 * nada nem iniciava outra sessão. A tela pode até perder o chat; ele não pode
 * perder o fio.
 *
 * Isto é diferente da memória de fatos. A memória guarda o que ele APRENDEU
 * ("o dono usa Cursor"); isto guarda o que foi DITO, na ordem, com as ações
 * executadas — é o que faz "e o segundo?" continuar fazendo sentido amanhã.
 */

export type MensagemGuardada = {
  role: "user" | "assistant";
  content: string;
  acoes?: AcaoJarvis[];
};

/**
 * Quanto voltar para a tela e para o modelo.
 *
 * O modelo já recebe só a janela recente (`JANELA_DE_HISTORICO`); o resto vive
 * aqui para a tela e para um dia virar resumo. Sessenta mensagens são uns
 * dois dias de uso e cabem numa rolagem.
 */
const LIMITE_PADRAO = 60;

export async function registrar(mensagens: MensagemGuardada[]): Promise<void> {
  const validas = mensagens.filter((m) => m.content.trim().length > 0);
  if (validas.length === 0) return;

  await ensureSchema();
  await filaDeEscrita(async () => {
    await getDb()
      .insert(conversa)
      .values(
        validas.map((m) => ({
          role: m.role,
          content: m.content,
          acoes: m.acoes && m.acoes.length > 0 ? JSON.stringify(m.acoes) : null,
        }))
      );
  });
}

export async function recentes(limite = LIMITE_PADRAO): Promise<MensagemGuardada[]> {
  await ensureSchema();
  // As últimas N, devolvidas na ordem em que aconteceram.
  const linhas = await getDb()
    .select()
    .from(conversa)
    .orderBy(desc(conversa.id))
    .limit(limite);

  return linhas.reverse().map((linha) => ({
    role: linha.role,
    content: linha.content,
    ...(linha.acoes ? { acoes: lerAcoes(linha.acoes) } : {}),
  }));
}

/** Esquecer a conversa é decisão explícita do dono, pelo botão. */
export async function limpar(): Promise<void> {
  await ensureSchema();
  await filaDeEscrita(async () => {
    await getDb().delete(conversa);
  });
}

export async function contar(): Promise<number> {
  await ensureSchema();
  const linhas = await getDb().select({ id: conversa.id }).from(conversa).orderBy(asc(conversa.id));
  return linhas.length;
}

function lerAcoes(texto: string): AcaoJarvis[] {
  try {
    const lidas = JSON.parse(texto);
    return Array.isArray(lidas) ? (lidas as AcaoJarvis[]) : [];
  } catch {
    // Linha corrompida não pode derrubar a restauração da conversa inteira.
    return [];
  }
}
