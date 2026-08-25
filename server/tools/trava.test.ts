import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventoBrutoJarvis, PerguntaPendente } from "@shared/jarvisStream";
import { invokeTool, type ContextoDeExecucao } from "./registry";
import {
  responderPergunta,
  TEMPO_CONFIRMACAO_MS,
  _abertas,
  _zerar,
} from "../interacao/perguntas";

/**
 * A trava de ações destrutivas.
 *
 * Estes testes provam a única coisa que separa um assistente de um acidente:
 * que `runPowerShell` NÃO é chamado enquanto a confirmação está pendente, e que
 * todo desfecho diferente de autorização explícita impede a execução.
 */

const shell = vi.hoisted(() => ({ chamadas: [] as string[] }));

vi.mock("./shell", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("./shell")>();
  return {
    ...original,
    runPowerShell: vi.fn(async (comando: string) => {
      shell.chamadas.push(comando);
      return { ok: true, output: "executado" };
    }),
  };
});

function contexto(overrides: Partial<ContextoDeExecucao> = {}) {
  const eventos: EventoBrutoJarvis[] = [];
  const ctx: ContextoDeExecucao = {
    execucaoId: "exec-1",
    acaoId: "acao-1",
    sinal: new AbortController().signal,
    emitir: (evento) => eventos.push(evento),
    interativo: true,
    autorizacoes: new Set(),
    perguntasFeitas: 0,
    prazoMs: 30_000,
    creditarEspera: () => {},
    ...overrides,
  };
  return { ctx, eventos };
}

function perguntaDe(eventos: EventoBrutoJarvis[]): PerguntaPendente | undefined {
  const evento = eventos.find((e) => e.tipo === "pergunta");
  return evento && evento.tipo === "pergunta" ? evento.pergunta : undefined;
}

beforeEach(() => {
  shell.chamadas = [];
  _zerar();
});

afterEach(() => {
  vi.useRealTimers();
  _zerar();
});

describe("a trava de ações destrutivas", () => {
  it("NÃO executa enquanto a confirmação está aberta", async () => {
    const { ctx, eventos } = contexto();

    const promessa = invokeTool("encerrar_processo", JSON.stringify({ alvo: "notepad" }), ctx);
    // Deixa o microtask rodar até o ponto em que a promessa bloqueia.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // O ponto do teste: o comando não rodou.
    expect(shell.chamadas).toHaveLength(0);
    expect(_abertas()).toBe(1);

    const pergunta = perguntaDe(eventos);
    expect(pergunta).toBeDefined();
    // O evento de início não pode ter saído ainda: a interface mostraria
    // "executando" para uma ação que talvez nunca role.
    expect(eventos.some((e) => e.tipo === "acao_inicio")).toBe(false);

    responderPergunta({ perguntaId: pergunta!.id, opcaoId: "sim", origem: "clique" });
    const resultado = await promessa;

    expect(shell.chamadas).toHaveLength(1);
    expect(resultado.bloqueada).toBe(false);
    // Agora sim o início saiu, e depois da confirmação.
    expect(eventos.some((e) => e.tipo === "acao_inicio")).toBe(true);
  });

  it("recusa impede a execução e orienta o modelo a não insistir", async () => {
    const { ctx, eventos } = contexto();

    const promessa = invokeTool("encerrar_processo", JSON.stringify({ alvo: "chrome" }), ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));

    responderPergunta({ perguntaId: perguntaDe(eventos)!.id, opcaoId: "nao", origem: "clique" });
    const resultado = await promessa;

    expect(shell.chamadas).toHaveLength(0);
    expect(resultado.bloqueada).toBe(true);
    expect(resultado.ok).toBe(false);
    expect(resultado.output).toContain("NÃO foi executada");
    expect(resultado.output).toContain("não tente outro caminho");
  });

  it("expiração bloqueia igual a recusa: silêncio nunca é sim", async () => {
    vi.useFakeTimers();
    const { ctx, eventos } = contexto();

    const promessa = invokeTool("encerrar_processo", JSON.stringify({ alvo: "notepad" }), ctx);
    await vi.advanceTimersByTimeAsync(0);
    expect(perguntaDe(eventos)).toBeDefined();

    await vi.advanceTimersByTimeAsync(TEMPO_CONFIRMACAO_MS + 1000);
    const resultado = await promessa;

    expect(shell.chamadas).toHaveLength(0);
    expect(resultado.bloqueada).toBe(true);
    expect(resultado.output).toContain("não confirmou a tempo");
  });

  it("a trava vale pelo curinga: PowerShell destrutivo também para", async () => {
    // Sem isto, a porta larga contornaria toda a proteção.
    const { ctx, eventos } = contexto();

    const promessa = invokeTool(
      "executar_powershell",
      JSON.stringify({ comando: "Remove-Item C:\\temp\\x -Recurse -Force" }),
      ctx
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shell.chamadas).toHaveLength(0);
    responderPergunta({ perguntaId: perguntaDe(eventos)!.id, opcaoId: "nao", origem: "clique" });
    const resultado = await promessa;

    expect(shell.chamadas).toHaveLength(0);
    expect(resultado.bloqueada).toBe(true);
  });

  it("abrir_programa com argumentos passa pela trava", async () => {
    const { ctx, eventos } = contexto();

    const promessa = invokeTool(
      "abrir_programa",
      JSON.stringify({ nome: "cmd", argumentos: "/c rd /s /q C:\\Users\\es553\\Documentos" }),
      ctx
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shell.chamadas).toHaveLength(0);
    expect(perguntaDe(eventos)?.nivel).toBe("critico");

    responderPergunta({ perguntaId: perguntaDe(eventos)!.id, opcaoId: "nao", origem: "clique" });
    await promessa;
    expect(shell.chamadas).toHaveLength(0);
  });

  it("VOZ nunca autoriza uma confirmação — só clique", async () => {
    /*
     * Num notebook com microfone e alto-falante embutidos, o Jarvis fala
     * "isso encerra o Chrome, confirma?" e o reconhecedor transcreve a própria
     * fala dele. A palavra "confirma" autorizaria a ação sozinha.
     */
    const { ctx, eventos } = contexto();

    const promessa = invokeTool("encerrar_processo", JSON.stringify({ alvo: "chrome" }), ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const pergunta = perguntaDe(eventos)!;
    const tentativa = responderPergunta({
      perguntaId: pergunta.id,
      texto: "confirma",
      origem: "voz",
    });

    expect(tentativa).toMatchObject({ aceita: false, motivo: "voz_nao_autoriza" });
    expect(shell.chamadas).toHaveLength(0);
    // A pergunta continua aberta, esperando o clique.
    expect(_abertas()).toBe(1);

    responderPergunta({ perguntaId: pergunta.id, opcaoId: "nao", origem: "clique" });
    await promessa;
  });

  it("leitura não abre pergunta nenhuma", async () => {
    const { ctx, eventos } = contexto();
    await invokeTool("listar_processos", JSON.stringify({}), ctx);

    expect(eventos.some((e) => e.tipo === "pergunta")).toBe(false);
    expect(shell.chamadas).toHaveLength(1);
  });

  it("autorização já concedida na execução dispensa nova pergunta", async () => {
    const { ctx, eventos } = contexto({
      autorizacoes: new Set(["encerrar_processo:notepad"]),
    });

    const resultado = await invokeTool(
      "encerrar_processo",
      JSON.stringify({ alvo: "notepad" }),
      ctx
    );

    expect(eventos.some((e) => e.tipo === "pergunta")).toBe(false);
    expect(shell.chamadas).toHaveLength(1);
    expect(resultado.bloqueada).toBe(false);
  });

  it("sem canal interativo, a ação é bloqueada em vez de pendurar", async () => {
    // Pelo caminho sem stream, esperar noventa segundos e voltar dizendo que
    // nada foi feito seria pior que recusar na hora.
    const { ctx } = contexto({ interativo: false });

    const resultado = await invokeTool(
      "encerrar_processo",
      JSON.stringify({ alvo: "notepad" }),
      ctx
    );

    expect(shell.chamadas).toHaveLength(0);
    expect(resultado.bloqueada).toBe(true);
    expect(_abertas()).toBe(0);
  });

  it("cancelar a execução resolve a pergunta e não executa", async () => {
    const controle = new AbortController();
    const { ctx, eventos } = contexto({ sinal: controle.signal });

    const promessa = invokeTool("encerrar_processo", JSON.stringify({ alvo: "notepad" }), ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(perguntaDe(eventos)).toBeDefined();

    controle.abort();
    const resultado = await promessa;

    expect(shell.chamadas).toHaveLength(0);
    expect(resultado.bloqueada).toBe(true);
    expect(_abertas()).toBe(0);
  });
});
