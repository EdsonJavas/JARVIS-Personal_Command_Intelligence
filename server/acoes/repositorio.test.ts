import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type Repositorio = typeof import("./repositorio");
let repo: Repositorio;
let pasta: string;

beforeAll(async () => {
  pasta = mkdtempSync(join(tmpdir(), "jarvis-acoes-"));
  process.env.DATABASE_URL = join(pasta, "teste.db");
  repo = await import("./repositorio");
});

afterAll(() => {
  try {
    rmSync(pasta, { recursive: true, force: true });
  } catch {
    /* o Windows solta depois */
  }
});

const acao = (n: number, ok = true) => ({
  execucaoId: `exec-${Math.ceil(n / 2)}`,
  ferramenta: n % 2 ? "buscar_arquivos" : "executar_powershell",
  detalhe: `detalhe ${n}`,
  resumo: `resumo ${n}`,
  ok,
  bloqueada: false,
  duracaoMs: 120,
  pedido: "acha o contrato",
});

describe("registro de ações", () => {
  it("nasce vazio, sem estourar por falta de tabela", async () => {
    expect(await repo.listarAcoes()).toEqual([]);
  });

  it("devolve as mais recentes primeiro, e pagina por 'antes'", async () => {
    for (let n = 1; n <= 6; n += 1) await repo.registrarAcaoAgora(acao(n, n !== 4));

    const pagina1 = await repo.listarAcoes({ limite: 4 });
    expect(pagina1.map((a) => a.resumo)).toEqual(["resumo 6", "resumo 5", "resumo 4", "resumo 3"]);
    expect(pagina1[2].ok).toBe(false);

    const pagina2 = await repo.listarAcoes({ antes: pagina1[3].id, limite: 4 });
    expect(pagina2.map((a) => a.resumo)).toEqual(["resumo 2", "resumo 1"]);
  });

  it("guarda o pedido do dono, encurtado", async () => {
    await repo.registrarAcaoAgora({ ...acao(9), pedido: "x".repeat(500) });
    const [ultima] = await repo.listarAcoes({ limite: 1 });
    expect(ultima.pedido).toHaveLength(200);
  });
});
