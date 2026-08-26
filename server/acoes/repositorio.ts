import { desc, lt } from "drizzle-orm";
import { acoesExecutadas } from "../../drizzle/schema";
import { ensureSchema, filaDeEscrita, getDb } from "../db";

/**
 * Registro do que o Jarvis FEZ, próprio e permanente.
 *
 * A conversa guarda ações por turno, mas a conversa é do dono: ele limpa
 * quando quer, e ela é cortada em sessenta mensagens. O registro do que foi
 * executado na máquina não pode depender disso — é a trilha de auditoria de
 * um assistente que age sozinho. Nada aqui é apagado por "limpar conversa".
 */

export type AcaoRegistrada = {
  execucaoId: string;
  ferramenta: string;
  detalhe: string;
  resumo: string;
  ok: boolean;
  bloqueada: boolean;
  duracaoMs: number;
  /** A fala do dono que motivou o turno, encurtada. */
  pedido: string;
};

export function registrarAcao(acao: AcaoRegistrada): void {
  // Nunca aguardado pelo laço: uma falha aqui não pode atrasar a resposta.
  void ensureSchema()
    .then(() =>
      filaDeEscrita(async () => {
        await getDb()
          .insert(acoesExecutadas)
          .values({
            execucaoId: acao.execucaoId,
            ferramenta: acao.ferramenta,
            detalhe: acao.detalhe.slice(0, 2000),
            resumo: acao.resumo.slice(0, 400),
            ok: acao.ok,
            bloqueada: acao.bloqueada,
            duracaoMs: Math.max(0, Math.round(acao.duracaoMs)),
            pedido: acao.pedido.slice(0, 200),
          });
      })
    )
    .catch((erro) => console.warn("[Ações] não registrou:", String(erro).slice(0, 120)));
}

export async function listarAcoes(opcoes: { antes?: number; limite?: number } = {}) {
  await ensureSchema();
  const limite = Math.min(100, Math.max(1, opcoes.limite ?? 50));
  const consulta = getDb().select().from(acoesExecutadas);
  const linhas = await (opcoes.antes
    ? consulta.where(lt(acoesExecutadas.id, opcoes.antes))
    : consulta
  )
    .orderBy(desc(acoesExecutadas.id))
    .limit(limite);

  return linhas.map((l) => ({
    id: l.id,
    execucaoId: l.execucaoId,
    ferramenta: l.ferramenta,
    detalhe: l.detalhe,
    resumo: l.resumo,
    ok: l.ok,
    bloqueada: l.bloqueada,
    duracaoMs: l.duracaoMs,
    pedido: l.pedido,
    em: l.em.toISOString(),
  }));
}

/** Para o teste: grava e ESPERA, em vez de disparar e seguir. */
export async function registrarAcaoAgora(acao: AcaoRegistrada): Promise<void> {
  await ensureSchema();
  await filaDeEscrita(async () => {
    await getDb().insert(acoesExecutadas).values({
      execucaoId: acao.execucaoId,
      ferramenta: acao.ferramenta,
      detalhe: acao.detalhe.slice(0, 2000),
      resumo: acao.resumo.slice(0, 400),
      ok: acao.ok,
      bloqueada: acao.bloqueada,
      duracaoMs: Math.max(0, Math.round(acao.duracaoMs)),
      pedido: acao.pedido.slice(0, 200),
    });
  });
}
