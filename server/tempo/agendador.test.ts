import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * O relógio, de ponta a ponta: cria, vence, dispara.
 *
 * Tudo por import dinâmico e contra um banco próprio — um `import` estático
 * carregaria a configuração do banco antes do `beforeAll`, e a suíte gravaria no
 * banco de verdade do dono. Já aconteceu.
 */

type Agendador = typeof import("./agendador");
type Compromissos = typeof import("./compromissos");

let agendador: Agendador;
let repo: Compromissos;
let pasta: string;

beforeAll(async () => {
  pasta = mkdtempSync(join(tmpdir(), "jarvis-agendador-"));
  process.env.DATABASE_URL = join(pasta, "teste.db");
  agendador = await import("./agendador");
  repo = await import("./compromissos");
});

afterAll(() => {
  agendador.pararAgendador();
  try {
    rmSync(pasta, { recursive: true, force: true });
  } catch {
    /* no Windows o SQLite ainda segura o arquivo; o sistema recolhe depois */
  }
});

/** Um instante bem à frente, para o que foi marcado já ter vencido. */
function daquiA(horas: number): Date {
  return new Date(Date.now() + horas * 3600_000);
}

describe("verificar vencidos", () => {
  it("banco vazio não dispara nada", async () => {
    expect(await agendador.verificarVencidos(new Date())).toEqual([]);
  });

  it("lembrete vencido dispara UMA vez e não volta", async () => {
    const criado = await repo.criarLembrete({ texto: "a reunião é agora", quando: "em 10 minutos" });
    expect(criado.ok).toBe(true);

    const primeira = await agendador.verificarVencidos(daquiA(1));
    expect(primeira).toHaveLength(1);
    expect(primeira[0].tipo).toBe("lembrete");
    expect(primeira[0].texto).toBe("a reunião é agora");

    // A segunda volta do relógio não pode repetir o mesmo aviso.
    expect(await agendador.verificarVencidos(daquiA(2))).toHaveLength(0);
  });

  it("lembrete ainda no futuro fica quieto", async () => {
    await repo.criarLembrete({ texto: "só mais tarde", quando: "em 5 horas" });
    expect(await agendador.verificarVencidos(new Date())).toHaveLength(0);
  });

  it("rotina dispara e se reagenda em vez de morrer", async () => {
    const limpar = await repo.listarCompromissos();
    for (const c of limpar) await repo.cancelarCompromisso(c.id);

    await repo.criarRotina({ texto: "o resumo do dia", horaDoDia: 8 * 60 });

    const disparadas = await agendador.verificarVencidos(daquiA(48));
    expect(disparadas).toHaveLength(1);
    expect(disparadas[0].tipo).toBe("rotina");

    // Continua ativa, com data futura: rotina não morre depois de tocar.
    const [rotina] = await repo.listarCompromissos();
    expect(rotina.ativo).toBe(true);
    expect(rotina.proximaEm!.getTime()).toBeGreaterThan(Date.now());
  });

  it("compromisso cancelado nunca dispara", async () => {
    const limpar = await repo.listarCompromissos();
    for (const c of limpar) await repo.cancelarCompromisso(c.id);

    const criado = await repo.criarLembrete({ texto: "cancelado", quando: "em 10 minutos" });
    if (!criado.ok) throw new Error("esperava lembrete");
    await repo.cancelarCompromisso(criado.compromisso.id);

    expect(await agendador.verificarVencidos(daquiA(1))).toHaveLength(0);
  });
});

describe("leitura de métrica", () => {
  const stats = {
    cpu: { usagePercent: 42 },
    memory: { usedPercent: 71 },
    disks: [
      { name: "D:", usedPercent: 10 },
      { name: "C:", usedPercent: 88 },
    ],
    battery: { percent: 33 },
  } as never;

  it("lê cada métrica do lugar certo", () => {
    expect(agendador.lerMetrica("cpu", stats)).toBe(42);
    expect(agendador.lerMetrica("memoria", stats)).toBe(71);
    expect(agendador.lerMetrica("bateria", stats)).toBe(33);
  });

  it("disco é o do SISTEMA, não o primeiro da lista", () => {
    // Pegar o primeiro faria o vigia de disco observar um HD secundário vazio
    // enquanto o C: enche — e o aviso nunca viria.
    expect(agendador.lerMetrica("disco", stats)).toBe(88);
  });

  it("métrica não coletada devolve nulo em vez de zero", () => {
    // Zero passaria por qualquer comparação "abaixo de" e dispararia sozinho.
    expect(agendador.lerMetrica("temperatura", stats)).toBeNull();
    expect(agendador.lerMetrica("bateria", { ...stats, battery: null } as never)).toBeNull();
  });
});
