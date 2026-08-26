import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { createOwnerSession, passwordMatches } from "./auth";
import { ENV } from "./_core/env";
import { generateJarvisReply, jarvisMessageSchema, JarvisProviderError } from "./jarvisAi";
import { synthesizeSpeech } from "./jarvisTts";
import { vozesDisponiveis, vozLocalDisponivel, vozLocalPadrao } from "./vozLocal";
import { vozesMicrosoft, vozMicrosoftLigada, vozMicrosoftPadrao } from "./vozMicrosoft";
import { collectSystemStats } from "./systemStats";
import { concluirTurno, prepararTurno } from "./jarvis/turno";
import { collectWorld } from "./world";
import { collectDevLife } from "./devLife";
import { listarCartoes, removerCartao } from "./board";
import { esquecer, listarMemorias, restaurar } from "./memoria/repositorio";
import { limpar as limparConversa, recentes as conversaRecente } from "./conversa/repositorio";
import { listarCompromissos } from "./tempo/compromissos";
import { responderPergunta } from "./interacao/perguntas";
import { cancelar, execucaoAtivaDe } from "./execucoes";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

/**
 * Limitador simples de tentativas de senha, por IP. Mantido em memória porque a
 * instalação é de um usuário só; reiniciar o servidor zera a contagem.
 */
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;
const attempts = new Map<string, { count: number; firstAt: number }>();

function registerFailure(ip: string) {
  const now = Date.now();
  const current = attempts.get(ip);
  if (!current || now - current.firstAt > LOCKOUT_MS) {
    attempts.set(ip, { count: 1, firstAt: now });
    return;
  }
  current.count += 1;
}

function secondsUntilUnlock(ip: string): number {
  const current = attempts.get(ip);
  if (!current) return 0;
  if (Date.now() - current.firstAt > LOCKOUT_MS) {
    attempts.delete(ip);
    return 0;
  }
  if (current.count < MAX_ATTEMPTS) return 0;
  return Math.ceil((LOCKOUT_MS - (Date.now() - current.firstAt)) / 1000);
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),

    login: publicProcedure
      .input(z.object({ password: z.string().min(1).max(200) }))
      .mutation(async ({ input, ctx }) => {
        const ip = ctx.req.ip ?? "local";

        const waitSeconds = secondsUntilUnlock(ip);
        if (waitSeconds > 0) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: `Muitas tentativas. Tente novamente em ${waitSeconds}s.`,
          });
        }

        if (!ENV.appPassword) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "APP_PASSWORD não configurada no arquivo .env do servidor.",
          });
        }

        if (!passwordMatches(input.password)) {
          registerFailure(ip);
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Senha incorreta." });
        }

        attempts.delete(ip);

        const sessionToken = await createOwnerSession();
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

        return { success: true } as const;
      }),

    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  machine: router({
    /** Telemetria da máquina onde o servidor roda. Polled pelo painel. */
    stats: protectedProcedure.query(() => collectSystemStats()),
  }),

  /** Tudo o que o painel mostra além da máquina. */
  board: router({
    world: protectedProcedure.query(() => collectWorld()),
    dev: protectedProcedure.query(() => collectDevLife()),
    cards: protectedProcedure.query(() => listarCartoes()),
    removeCard: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(({ input }) => ({ removido: removerCartao(input.id) })),
  }),

  /**
   * O que o Jarvis aprendeu.
   *
   * Existe porque um assistente que aprende sozinho precisa ser auditável: o
   * dono tem que conseguir VER cada coisa guardada a seu respeito e apagar o que
   * não quer. Sem esta tela, a memória seria uma caixa-preta.
   */
  memoria: router({
    listar: protectedProcedure.query(async () => {
      const todas = await listarMemorias(true);
      return todas.map((memoria) => ({
        id: memoria.id,
        conteudo: memoria.conteudo,
        tipo: memoria.tipo,
        origem: memoria.origem,
        fixada: memoria.fixada,
        esquecida: memoria.esquecida,
        usos: memoria.usos ?? 0,
        versao: memoria.versao,
        atualizadaEm: memoria.atualizadaEm.toISOString(),
      }));
    }),

    esquecer: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => ({ esquecida: await esquecer(input.id, "apagada no painel") })),

    /** Esquecer é reversível de propósito; a tela expõe o desfazer. */
    restaurar: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => ({ restaurada: await restaurar(input.id) })),
  }),

  /** O que ele prometeu fazer sozinho. A tela mostra o que vem a seguir. */
  compromissos: router({
    proximos: protectedProcedure.query(async () => {
      const todos = await listarCompromissos();
      return todos.map((c) => ({
        id: c.id,
        tipo: c.tipo,
        texto: c.texto,
        proximaEm: c.proximaEm ? c.proximaEm.toISOString() : null,
        metrica: c.metrica,
        comparacao: c.comparacao,
        limite: c.limite,
        armado: c.armado,
      }));
    }),
  }),

  jarvis: router({
    /** A conversa de onde parou, para a tela não abrir vazia. */
    conversa: protectedProcedure.query(async () => conversaRecente()),
    /** Esquecer a conversa é o botão de limpar — decisão do dono, não da aba. */
    limparConversa: protectedProcedure.mutation(async () => {
      await limparConversa();
      return { ok: true };
    }),

    chat: protectedProcedure
      .input(z.object({ messages: z.array(jarvisMessageSchema).min(1).max(12) }))
      .mutation(async ({ input, ctx }) => {
        console.info("[Jarvis] Pedido autenticado recebido", {
          userId: ctx.user.id,
          messageCount: input.messages.length,
        });
        try {
          // O estado da máquina entra na instrução de sistema a cada pergunta,
          // então o Jarvis responde sobre o computador com a medição do momento.
          // `interativo: false` porque esta rota não tem canal para perguntar:
          // uma confirmação aqui penduraria a chamada até o tempo esgotar.
          const turno = await prepararTurno(input.messages);
          const response = await generateJarvisReply(input.messages, {
            relatorioDaMaquina: turno.relatorioDaMaquina,
            memorias: turno.memorias,
            interativo: false,
          });
          concluirTurno({ usadas: turno.usadas });
          console.info("[Jarvis] Resposta gerada", { userId: ctx.user.id });
          return response;
        } catch (error) {
          if (error instanceof JarvisProviderError) {
            const code = error.kind === "missing_key"
              ? "PRECONDITION_FAILED"
              : error.kind === "quota_exceeded"
                ? "TOO_MANY_REQUESTS"
                : "BAD_GATEWAY";
            throw new TRPCError({ code, message: error.message, cause: error });
          }
          throw error;
        }
      }),

    /** Resposta a uma pergunta aberta pelo laço. */
    responder: protectedProcedure
      .input(
        z.object({
          perguntaId: z.string().min(1),
          opcaoId: z.string().min(1).optional(),
          texto: z.string().max(2000).optional(),
          // A origem importa: em confirmação, voz nunca autoriza — só clique.
          origem: z.enum(["clique", "voz", "texto"]),
          cancelar: z.boolean().optional(),
        })
      )
      .mutation(({ input }) => responderPergunta(input)),

    /** A segunda janela não conhece o id da execução; descobre pela sessão. */
    execucaoAtiva: protectedProcedure.query(({ ctx }) => execucaoAtivaDe(ctx.user.id)),

    cancelarExecucao: protectedProcedure
      .input(z.object({ execucaoId: z.string().min(1) }))
      .mutation(({ input }) => ({ cancelada: cancelar(input.execucaoId, "usuario") })),

    /**
     * Quais vozes o SERVIDOR oferece.
     *
     * O cliente precisa saber disto para decidir a política de fala: havendo
     * voz local, ela ganha de qualquer voz do navegador — é neural, ilimitada e
     * soa igual em Chrome, Edge ou Firefox.
     */
    vozes: protectedProcedure.query(async () => ({
      localDisponivel: vozLocalDisponivel(),
      padrao: vozMicrosoftLigada() ? vozMicrosoftPadrao() : vozLocalPadrao()?.id ?? null,
      vozes: vozesDisponiveis().map((voz) => ({ id: voz.id, nome: voz.nome })),
      /*
       * As neurais da Microsoft, faladas pelo servidor. Chegam separadas das
       * locais porque a escolha entre elas é uma troca real: as da Microsoft
       * soam melhor, as do Piper funcionam sem internet.
       */
      microsoft: vozMicrosoftLigada() ? await vozesMicrosoft() : [],
    })),

    speak: protectedProcedure
      .input(
        z.object({
          text: z.string().trim().min(1).max(6000),
          /* Anúncio de ação cede a vez à resposta quando a cota do dia aperta. */
          prioridade: z.enum(["resposta", "anuncio"]).default("resposta"),
          /* Qual voz local usar. Ausente = a padrão do servidor. */
          voz: z.string().max(80).optional(),
        })
      )
      .mutation(async ({ input }) => {
        try {
          return await synthesizeSpeech(input.text, {
            prioridade: input.prioridade,
            voz: input.voz,
          });
        } catch (error) {
          if (error instanceof JarvisProviderError) {
            const code = error.kind === "missing_key"
              ? "PRECONDITION_FAILED"
              : error.kind === "quota_exceeded"
                ? "TOO_MANY_REQUESTS"
                : "BAD_GATEWAY";
            throw new TRPCError({ code, message: error.message, cause: error });
          }
          throw error;
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;
