import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventoJarvis } from "@shared/jarvisStream";
import { GRACA_ORFA_MS } from "@shared/jarvisStream";
import {
  anexar,
  cancelar,
  desanexar,
  emitir,
  execucaoAtivaDe,
  ganchosDePergunta,
  iniciarExecucao,
  obter,
  _tamanhoDoRegistro,
  _zerarRegistro,
} from "./execucoes";

const DONO = 1;
const OUTRO = 2;

beforeEach(() => {
  _zerarRegistro();
  ganchosDePergunta.abertaDe = () => null;
  ganchosDePergunta.abortarDaExecucao = () => 0;
});

afterEach(() => {
  vi.useRealTimers();
  _zerarRegistro();
});

function novaExecucao(usuarioId = DONO) {
  return iniciarExecucao({ usuarioId, mensagens: [] });
}

describe("registro de execuções", () => {
  it("numera os eventos em sequência a partir de um", () => {
    const execucao = novaExecucao();
    emitir(execucao.id, { tipo: "pensando", rodada: 1 });
    emitir(execucao.id, { tipo: "pensando", rodada: 2 });

    expect(execucao.eventos.map((e) => e.seq)).toEqual([1, 2]);
    expect(execucao.eventos[0].em).toBeGreaterThan(0);
  });

  it("anexar com desdeSeq reproduz só o que faltou e segue ao vivo", () => {
    const execucao = novaExecucao();
    for (let i = 1; i <= 5; i += 1) emitir(execucao.id, { tipo: "pensando", rodada: i });

    const recebidos: EventoJarvis[] = [];
    const resultado = anexar(execucao.id, 3, (evento) => recebidos.push(evento), DONO);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.atrasados.map((e) => e.seq)).toEqual([4, 5]);

    emitir(execucao.id, { tipo: "pensando", rodada: 6 });
    expect(recebidos.map((e) => e.seq)).toEqual([6]);
  });

  it("recusa execução de outro usuário", () => {
    const execucao = novaExecucao(DONO);
    expect(obter(execucao.id, OUTRO)).toBeNull();
    expect(anexar(execucao.id, 0, () => {}, OUTRO)).toMatchObject({
      ok: false,
      motivo: "de_outro_usuario",
    });
  });

  it("iniciar uma execução cancela a anterior do mesmo usuário", () => {
    // Duas janelas abertas não podem disparar duas varreduras de disco
    // concorrentes na mesma máquina.
    const primeira = novaExecucao(DONO);
    novaExecucao(DONO);

    expect(primeira.estado).toBe("terminada");
    expect(primeira.abort.signal.aborted).toBe(true);
    expect(primeira.eventos.at(-1)).toMatchObject({ tipo: "cancelado", motivo: "nova_mensagem" });
  });

  it("execução de outro usuário não é cancelada", () => {
    const doOutro = novaExecucao(OUTRO);
    novaExecucao(DONO);
    expect(doOutro.estado).toBe("correndo");
  });

  it("evento terminal encerra a execução e para de aceitar carência", () => {
    const execucao = novaExecucao();
    emitir(execucao.id, {
      tipo: "resposta",
      texto: "pronto",
      fala: "pronto",
      modelo: "m",
      motivoDeParada: "concluido",
      acoes: [],
    });
    expect(execucao.estado).toBe("terminada");
    expect(execucao.terminadaEm).toBeGreaterThan(0);
  });

  it("órfã é cancelada depois da carência", () => {
    vi.useFakeTimers();
    const execucao = novaExecucao();
    const ouvinte = () => {};
    anexar(execucao.id, 0, ouvinte, DONO);

    desanexar(execucao.id, ouvinte);
    expect(execucao.estado).toBe("orfa");

    vi.advanceTimersByTime(GRACA_ORFA_MS - 1000);
    expect(execucao.abort.signal.aborted).toBe(false);

    vi.advanceTimersByTime(2000);
    expect(execucao.abort.signal.aborted).toBe(true);
  });

  it("reanexar dentro da carência cancela o aborto", () => {
    // Recarregar a página no meio de uma tarefa não pode matá-la.
    vi.useFakeTimers();
    const execucao = novaExecucao();
    const primeiro = () => {};
    anexar(execucao.id, 0, primeiro, DONO);
    desanexar(execucao.id, primeiro);

    vi.advanceTimersByTime(GRACA_ORFA_MS - 2000);
    anexar(execucao.id, 0, () => {}, DONO);
    expect(execucao.estado).toBe("correndo");

    vi.advanceTimersByTime(GRACA_ORFA_MS * 2);
    expect(execucao.abort.signal.aborted).toBe(false);
  });

  it("a carência é estendida enquanto houver pergunta aberta", () => {
    vi.useFakeTimers();
    const execucao = novaExecucao();
    const expiraEm = Date.now() + GRACA_ORFA_MS * 6;
    ganchosDePergunta.abertaDe = () =>
      ({ expiraEm } as never);

    const ouvinte = () => {};
    anexar(execucao.id, 0, ouvinte, DONO);
    desanexar(execucao.id, ouvinte);

    // Passada a carência padrão, a execução segue viva por causa da pergunta.
    vi.advanceTimersByTime(GRACA_ORFA_MS * 2);
    expect(execucao.abort.signal.aborted).toBe(false);

    vi.advanceTimersByTime(GRACA_ORFA_MS * 5);
    expect(execucao.abort.signal.aborted).toBe(true);
  });

  it("cancelar fecha as perguntas abertas ANTES de abortar", () => {
    // Ordem importa: abortar primeiro deixaria a promessa da pergunta pendurada
    // segurando a conversa inteira em memória.
    const ordem: string[] = [];
    ganchosDePergunta.abortarDaExecucao = () => {
      ordem.push("perguntas");
      return 1;
    };

    const execucao = novaExecucao();
    execucao.abort.signal.addEventListener("abort", () => ordem.push("abort"));

    cancelar(execucao.id, "usuario");
    expect(ordem).toEqual(["perguntas", "abort"]);
  });

  it("cancelar duas vezes não emite dois eventos", () => {
    const execucao = novaExecucao();
    expect(cancelar(execucao.id, "usuario")).toBe(true);
    expect(cancelar(execucao.id, "usuario")).toBe(false);
    expect(execucao.eventos.filter((e) => e.tipo === "cancelado")).toHaveLength(1);
  });

  it("a execução ativa é encontrada pela sessão, sem conhecer o id", () => {
    // A segunda janela nunca viu o evento de início.
    const execucao = novaExecucao(DONO);
    expect(execucaoAtivaDe(DONO)).toMatchObject({ execucaoId: execucao.id });
    expect(execucaoAtivaDe(OUTRO)).toBeNull();
  });

  it("um ouvinte que lança não impede os outros de receberem", () => {
    const execucao = novaExecucao();
    const recebidos: number[] = [];
    anexar(execucao.id, 0, () => {
      throw new Error("quebrado");
    }, DONO);
    anexar(execucao.id, 0, (evento) => recebidos.push(evento.seq), DONO);

    emitir(execucao.id, { tipo: "pensando", rodada: 1 });
    expect(recebidos).toEqual([1]);
  });

  it("o registro respeita o teto de execuções guardadas", () => {
    for (let i = 0; i < 30; i += 1) {
      const execucao = iniciarExecucao({ usuarioId: 100 + i, mensagens: [] });
      emitir(execucao.id, { tipo: "cancelado", motivo: "usuario" });
    }
    // Sem despejo, um processo ligado por dias acumularia para sempre.
    expect(_tamanhoDoRegistro()).toBeLessThanOrEqual(20);
  });
});
