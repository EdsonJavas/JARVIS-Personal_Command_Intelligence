import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Compromisso } from "../../drizzle/schema";

/**
 * Contra SQLite de verdade, em arquivo temporário.
 *
 * Os defeitos desta camada são de integração — migração não esperada, update que
 * diz ter mexido em linha que não existe. Nenhum deles aparece contra mock.
 */

type Repo = typeof import("./compromissos");
let repo: Repo;
let pasta: string;

/*
 * TUDO por import dinâmico, inclusive as funções puras.
 *
 * Um `import` estático daqui carregaria o módulo — e com ele a configuração do
 * banco — antes do `beforeAll` trocar a variável, e a suíte gravava no banco de
 * verdade do dono. O vitest.config.ts já força um banco de teste; isto aqui é a
 * segunda tranca.
 */
let proximaDaRotina: Repo["proximaDaRotina"];
let vigiaDispara: Repo["vigiaDispara"];
let vigiaNormalizou: Repo["vigiaNormalizou"];

/** Quarta-feira, 19 de agosto de 2026, 14h30. */
const AGORA = new Date(2026, 7, 19, 14, 30, 0, 0);

beforeAll(async () => {
  pasta = mkdtempSync(join(tmpdir(), "jarvis-compromissos-"));
  process.env.DATABASE_URL = join(pasta, "teste.db");
  repo = await import("./compromissos");
  ({ proximaDaRotina, vigiaDispara, vigiaNormalizou } = repo);
});

afterAll(() => {
  // Melhor esforço: no Windows o SQLite ainda segura o arquivo quando o teste
  // termina, e falhar aqui reprovaria uma suíte que passou.
  try {
    rmSync(pasta, { recursive: true, force: true });
  } catch {
    /* o sistema recolhe depois */
  }
});

function vigia(overrides: Partial<Compromisso>): Compromisso {
  return {
    id: 1,
    tipo: "vigia",
    texto: "o disco está cheio",
    proximaEm: null,
    horaDoDia: null,
    diasDaSemana: null,
    metrica: "disco",
    comparacao: "acima",
    limite: 90,
    armado: true,
    ativo: true,
    ultimoDisparoEm: null,
    disparos: 0,
    criadoEm: AGORA,
    ...overrides,
  } as Compromisso;
}

describe("próxima da rotina", () => {
  it("hoje, quando o horário ainda não passou", () => {
    const proxima = proximaDaRotina(18 * 60, [], AGORA)!;
    expect(proxima.getDate()).toBe(19);
    expect(proxima.getHours()).toBe(18);
  });

  it("amanhã, quando o horário de hoje já passou", () => {
    const proxima = proximaDaRotina(8 * 60, [], AGORA)!;
    expect(proxima.getDate()).toBe(20);
  });

  it("pula para o próximo dia da semana escolhido", () => {
    // Quarta é 3; pedindo só segunda (1), são cinco dias.
    const proxima = proximaDaRotina(9 * 60, [1], AGORA)!;
    expect(proxima.getDay()).toBe(1);
    expect(proxima.getDate()).toBe(24);
  });

  it("dias úteis pulam o fim de semana", () => {
    const sexta = new Date(2026, 7, 21, 18, 0);
    const proxima = proximaDaRotina(9 * 60, [1, 2, 3, 4, 5], sexta)!;
    expect(proxima.getDay()).toBe(1);
  });

  it("lista de dias impossível não trava o laço", () => {
    // Dado corrompido não pode virar laço infinito no relógio do servidor.
    expect(proximaDaRotina(9 * 60, [99], AGORA)).toBeNull();
  });
});

describe("vigia", () => {
  it("dispara ao cruzar o limite, e só armado", () => {
    expect(vigiaDispara(vigia({}), 92)).toBe(true);
    expect(vigiaDispara(vigia({}), 88)).toBe(false);
    // Já disparado não repete: senão avisaria a cada volta do relógio.
    expect(vigiaDispara(vigia({ armado: false }), 92)).toBe(false);
  });

  it("funciona para baixo também", () => {
    const bateria = vigia({ metrica: "bateria", comparacao: "abaixo", limite: 20 });
    expect(vigiaDispara(bateria, 15)).toBe(true);
    expect(vigiaDispara(bateria, 25)).toBe(false);
  });

  it("métrica indisponível nunca dispara", () => {
    // Melhor calado do que avisar por causa de um número que não foi lido.
    expect(vigiaDispara(vigia({}), null)).toBe(false);
  });

  it("rearma só depois de afastar do limite, não ao encostar", () => {
    // Um disco oscilando entre 89% e 91% avisaria, rearmaria e avisaria de novo
    // sem parar. A folga é o que impede o tremor.
    const disparado = vigia({ armado: false });
    expect(vigiaNormalizou(disparado, 89)).toBe(false);
    expect(vigiaNormalizou(disparado, 80)).toBe(true);
  });

  it("armado nunca precisa rearmar", () => {
    expect(vigiaNormalizou(vigia({ armado: true }), 10)).toBe(false);
  });
});

describe("persistência", () => {
  it("cria lembrete em banco limpo", async () => {
    const r = await repo.criarLembrete({ texto: "ligar para o cliente", quando: "em 30 minutos" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.compromisso.tipo).toBe("lembrete");
    expect(r.compromisso.proximaEm).toBeInstanceOf(Date);
  });

  it("recusa lembrete que não dá para situar no tempo", async () => {
    // Aceitar calado criaria um compromisso que nunca dispara, e o dono acharia
    // que estava marcado.
    const r = await repo.criarLembrete({ texto: "algo", quando: "qualquer hora dessas" });
    expect(r.ok).toBe(false);
  });

  it("recusa lembrete sem texto", async () => {
    expect((await repo.criarLembrete({ texto: "  ", quando: "amanhã" })).ok).toBe(false);
  });

  it("cria rotina e calcula o próximo disparo", async () => {
    const r = await repo.criarRotina({ texto: "o resumo da manhã", horaDoDia: 8 * 60 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.compromisso.horaDoDia).toBe(8 * 60);
    expect(r.compromisso.proximaEm).toBeInstanceOf(Date);
  });

  it("recusa horário fora do dia", async () => {
    expect((await repo.criarRotina({ texto: "x", horaDoDia: 5000 })).ok).toBe(false);
  });

  it("cria vigia", async () => {
    const r = await repo.criarVigia({
      texto: "o disco está acabando",
      metrica: "disco",
      comparacao: "acima",
      limite: 90,
    });
    expect(r.ok).toBe(true);
  });

  it("lembrete some da lista depois de disparar; rotina reagenda", async () => {
    const todos = await repo.listarCompromissos();
    const lembrete = todos.find((c) => c.tipo === "lembrete")!;
    const rotina = todos.find((c) => c.tipo === "rotina")!;

    await repo.registrarDisparo(lembrete, AGORA);
    await repo.registrarDisparo(rotina, AGORA);

    const depois = await repo.listarCompromissos();
    expect(depois.some((c) => c.id === lembrete.id)).toBe(false);

    const rotinaDepois = depois.find((c) => c.id === rotina.id)!;
    expect(rotinaDepois.disparos).toBe(1);
    // Reagendada para o futuro, nunca para o mesmo instante.
    expect(rotinaDepois.proximaEm!.getTime()).toBeGreaterThan(AGORA.getTime());
  });

  it("cancelar devolve false para id que não existe", async () => {
    // O update do Drizzle entrega objeto mesmo sem casar linha nenhuma: sem a
    // leitura antes, a função diria ter cancelado o que nunca houve.
    expect(await repo.cancelarCompromisso(999_999)).toBe(false);
  });

  it("cancelar duas vezes só funciona na primeira", async () => {
    const [alvo] = await repo.listarCompromissos();
    expect(await repo.cancelarCompromisso(alvo.id)).toBe(true);
    expect(await repo.cancelarCompromisso(alvo.id)).toBe(false);
  });
});
