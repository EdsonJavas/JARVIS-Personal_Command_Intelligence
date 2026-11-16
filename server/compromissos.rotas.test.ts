import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * O mini sistema da ilha marca lembrete e rotina SEM passar pelo modelo.
 *
 * "Amanhã às 9h ligar pro contador" é conta de relógio, não redação: gastar uma
 * requisição de cota nisso seria jogar fora o recurso mais escasso do projeto.
 * O interpretador de datas é o mesmo que a ferramenta do modelo usa.
 */

type Rotas = typeof import("./routers");
let rotas: Rotas;
let pasta: string;

beforeAll(async () => {
  pasta = mkdtempSync(join(tmpdir(), "jarvis-rotas-compromissos-"));
  process.env.DATABASE_URL = join(pasta, "teste.db");
  rotas = await import("./routers");
});

afterAll(() => {
  try {
    rmSync(pasta, { recursive: true, force: true });
  } catch {
    /* o SQLite ainda segura o arquivo no Windows */
  }
});

function chamador() {
  const ctx: TrpcContext = {
    user: {
      id: 1,
      openId: "dono",
      email: null,
      name: "Edson",
      loginMethod: "password",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "http", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as TrpcContext;
  return rotas.appRouter.createCaller(ctx);
}

describe("compromissos pelo mini sistema", () => {
  it("interpreta o 'quando' antes de marcar, para a tela mostrar a data", async () => {
    const certo = await chamador().compromissos.interpretar({ quando: "em 20 minutos" });
    expect(certo.ok).toBe(true);
    if (certo.ok) {
      expect(new Date(certo.iso).getTime()).toBeGreaterThan(Date.now() + 19 * 60_000);
      expect(certo.descricao.length).toBeGreaterThan(0);
    }

    const errado = await chamador().compromissos.interpretar({ quando: "quando der" });
    expect(errado.ok).toBe(false);
  });

  it("marca um lembrete e ele aparece nos próximos", async () => {
    const criado = await chamador().compromissos.criarLembrete({
      texto: "Ligar pro contador",
      quando: "amanhã às 9h",
    });
    expect(criado.ok).toBe(true);

    const proximos = await chamador().compromissos.proximos();
    expect(proximos.some((c) => c.tipo === "lembrete" && c.texto === "Ligar pro contador")).toBe(true);
  });

  it("um 'quando' que não se entende volta com o motivo, sem gravar nada", async () => {
    const antes = (await chamador().compromissos.proximos()).length;
    const criado = await chamador().compromissos.criarLembrete({ texto: "x", quando: "algum dia" });
    expect(criado.ok).toBe(false);
    if (!criado.ok) expect(criado.motivo.length).toBeGreaterThan(0);
    expect((await chamador().compromissos.proximos()).length).toBe(antes);
  });

  it("marca uma rotina de dias úteis", async () => {
    const criada = await chamador().compromissos.criarRotina({
      texto: "Resumo da manhã",
      horaDoDia: 8 * 60,
      diasDaSemana: [1, 2, 3, 4, 5],
    });
    expect(criada.ok).toBe(true);

    const rotina = (await chamador().compromissos.proximos()).find((c) => c.texto === "Resumo da manhã");
    expect(rotina?.tipo).toBe("rotina");
    expect(rotina?.horaDoDia).toBe(480);
    expect(rotina?.diasDaSemana).toBe("1,2,3,4,5");
  });

  it("texto vazio é recusado pela validação", async () => {
    await expect(
      chamador().compromissos.criarLembrete({ texto: "   ", quando: "amanhã" })
    ).rejects.toThrow();
  });
});
