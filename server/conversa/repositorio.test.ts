import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Contra um SQLite de verdade, como o repositório de memória: o que se
 * verifica aqui é migração e ordem, e nenhum dos dois existe num mock.
 *
 * Import dinâmico porque `DATABASE_URL` precisa estar no ambiente ANTES do
 * módulo de configuração ser avaliado.
 */
type Repositorio = typeof import("./repositorio");

let repo: Repositorio;
let pasta: string;

beforeAll(async () => {
  pasta = mkdtempSync(join(tmpdir(), "jarvis-conversa-"));
  process.env.DATABASE_URL = join(pasta, "teste.db");
  repo = await import("./repositorio");
});

afterAll(() => {
  try {
    rmSync(pasta, { recursive: true, force: true });
  } catch {
    /* o Windows solta o arquivo depois */
  }
});

describe("conversa persistida", () => {
  it("começa vazia num banco novo, sem estourar por falta de tabela", async () => {
    expect(await repo.recentes()).toEqual([]);
  });

  it("guarda o turno na ordem, com as ações executadas", async () => {
    await repo.registrar([
      { role: "user", content: "Quanto tem de disco?" },
      {
        role: "assistant",
        content: "Duzentos e vinte gigas livres, senhor.",
        acoes: [{ tool: "estado_da_maquina", ok: true } as never],
      },
    ]);

    const tudo = await repo.recentes();
    expect(tudo.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(tudo[1].acoes).toHaveLength(1);
    expect(tudo[0].acoes).toBeUndefined();
  });

  it("devolve as ÚLTIMAS N, na ordem em que aconteceram", async () => {
    await repo.limpar();
    for (let i = 1; i <= 5; i += 1) {
      await repo.registrar([{ role: "user", content: `mensagem ${i}` }]);
    }

    const ultimas = await repo.recentes(3);
    // Não as três primeiras, e não de trás para a frente.
    expect(ultimas.map((m) => m.content)).toEqual(["mensagem 3", "mensagem 4", "mensagem 5"]);
  });

  it("mensagem vazia não vira linha", async () => {
    await repo.limpar();
    await repo.registrar([{ role: "assistant", content: "   " }]);
    expect(await repo.contar()).toBe(0);
  });

  it("limpar é total e explícito", async () => {
    await repo.registrar([{ role: "user", content: "oi" }]);
    await repo.limpar();
    expect(await repo.recentes()).toEqual([]);
  });
});
