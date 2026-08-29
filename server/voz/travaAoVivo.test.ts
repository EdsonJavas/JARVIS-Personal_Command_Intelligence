import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventoSemNumero, PerguntaPendente } from "@shared/jarvisStream";
import { _zerar, responderPergunta } from "../interacao/perguntas";
import { declaracoesParaLive, executarDaLive } from "./ferramentasAoVivo";

/**
 * A trava de risco no modo ao vivo.
 *
 * O dono foi categórico desde o começo: confirmação de ação destrutiva nunca é
 * aceita por voz, só por clique. O reconhecimento de fala erra, e um "não" que
 * vira "sim" apaga arquivo.
 *
 * O modo ao vivo é a maior tentação de furar isso — o modelo já está ouvindo,
 * seria "natural" ele aceitar um "pode apagar" falado. Estes testes existem
 * para que essa mudança nunca passe em branco. A trava não é reimplementada
 * aqui: é a mesma de `interacao/perguntas.ts`, e é isso que se verifica.
 */

beforeEach(() => _zerar());
afterEach(() => {
  _zerar();
  vi.useRealTimers();
});

function contexto(eventos: EventoSemNumero[]) {
  return {
    execucaoId: "exec-ao-vivo",
    sinal: new AbortController().signal,
    emitir: (e: EventoSemNumero) => eventos.push(e),
    autorizacoes: new Set<string>(),
    prazoMs: 5_000,
  };
}

const perguntaDe = (eventos: EventoSemNumero[]) =>
  (eventos.find((e) => e.tipo === "pergunta") as { pergunta: PerguntaPendente } | undefined)
    ?.pergunta;

describe("a trava de risco vale igual no modo ao vivo", () => {
  it("ação destrutiva abre pergunta e NÃO executa antes da resposta", async () => {
    const eventos: EventoSemNumero[] = [];
    let terminou = false;

    const corrida = executarDaLive(
      { name: "encerrar_processo", args: { alvo: "explorer" } },
      contexto(eventos)
    ).then((r) => {
      terminou = true;
      return r;
    });

    // Dá tempo de a pergunta ser aberta, sem responder nada.
    await new Promise((r) => setTimeout(r, 60));

    const pergunta = perguntaDe(eventos);
    expect(pergunta, "a ação destrutiva tem que abrir uma pergunta").toBeDefined();
    expect(pergunta!.nivel).not.toBe("normal");
    // O ponto central: a Live espera porque o `await` espera.
    expect(terminou, "não pode executar antes de o dono confirmar").toBe(false);

    responderPergunta({ perguntaId: pergunta!.id, opcaoId: "nao", origem: "clique" });
    const resultado = await corrida;
    expect(resultado.ok).toBe(false);
  });

  it("VOZ não autoriza: a mesma recusa de sempre, pelo mesmo caminho", async () => {
    const eventos: EventoSemNumero[] = [];
    const corrida = executarDaLive(
      { name: "encerrar_processo", args: { alvo: "explorer" } },
      contexto(eventos)
    );
    await new Promise((r) => setTimeout(r, 60));

    const pergunta = perguntaDe(eventos)!;
    const porVoz = responderPergunta({
      perguntaId: pergunta.id,
      opcaoId: "sim",
      origem: "voz",
    });

    expect(porVoz.aceita, "voz jamais autoriza ação destrutiva").toBe(false);

    // E o clique continua funcionando depois da recusa por voz.
    responderPergunta({ perguntaId: pergunta.id, opcaoId: "nao", origem: "clique" });
    await corrida;
  });

  it("emite acao_fim — senão a interface fica com a ação pendurada para sempre", async () => {
    const eventos: EventoSemNumero[] = [];
    await executarDaLive({ name: "limpar_painel", args: {} }, contexto(eventos));

    const fim = eventos.find((e) => e.tipo === "acao_fim");
    expect(fim, "invokeTool não emite acao_fim; a ponte precisa emitir").toBeDefined();
    expect((fim as { ferramenta: string }).ferramenta).toBe("limpar_painel");
  });

  it("ferramenta que não existe falha limpo, sem derrubar a sessão", async () => {
    const eventos: EventoSemNumero[] = [];
    const r = await executarDaLive({ name: "inventada_pelo_modelo", args: {} }, contexto(eventos));
    expect(r.ok).toBe(false);
  });
});

describe("o catálogo mandado à Live", () => {
  it("não leva grupo externo: os 33 KB da agenda custariam em cada aperto de mão", () => {
    const nomes = declaracoesParaLive().map((d) => d.name);
    expect(nomes.some((n) => n.startsWith("agenda_"))).toBe(false);
    expect(nomes.some((n) => n.startsWith("email_"))).toBe(false);
    expect(nomes).toContain("estado_da_maquina");
  });

  it("todo esquema sai no dialeto do Google, com tipo em maiúsculas", () => {
    for (const d of declaracoesParaLive()) {
      expect(d.parameters.type, `${d.name} sem tipo`).toBe("OBJECT");
      expect(JSON.stringify(d.parameters)).not.toContain("$schema");
      expect(JSON.stringify(d.parameters)).not.toContain("additionalProperties");
    }
  });
});
