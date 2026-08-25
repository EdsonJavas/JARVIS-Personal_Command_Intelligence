import { beforeAll, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

type CookieCall = { name: string; options: Record<string, unknown> };

const PASSWORD = "senha-de-teste";

// ENV lê process.env no momento do import, então definimos a senha antes de
// carregar os módulos que dependem dela.
process.env.APP_PASSWORD = PASSWORD;
process.env.JWT_SECRET = "segredo-de-teste-com-tamanho-suficiente";

let appRouter: typeof import("./routers").appRouter;
let passwordMatches: typeof import("./auth").passwordMatches;

beforeAll(async () => {
  vi.resetModules();
  ({ appRouter } = await import("./routers"));
  ({ passwordMatches } = await import("./auth"));
});

function createContext(ip: string): { ctx: TrpcContext; cookies: CookieCall[] } {
  const cookies: CookieCall[] = [];

  const ctx: TrpcContext = {
    user: null,
    req: { protocol: "https", headers: {}, ip } as TrpcContext["req"],
    res: {
      cookie: (name: string, _value: string, options: Record<string, unknown>) => {
        cookies.push({ name, options });
      },
    } as unknown as TrpcContext["res"],
  };

  return { ctx, cookies };
}

describe("passwordMatches", () => {
  it("aceita a senha configurada e recusa qualquer outra", () => {
    expect(passwordMatches(PASSWORD)).toBe(true);
    expect(passwordMatches("errada")).toBe(false);
    // Comprimentos diferentes não podem lançar: o digest iguala os tamanhos.
    expect(passwordMatches("x")).toBe(false);
    expect(passwordMatches("")).toBe(false);
  });
});

describe("auth.login", () => {
  it("recusa a senha errada sem emitir cookie", async () => {
    const { ctx, cookies } = createContext("10.0.0.1");
    const caller = appRouter.createCaller(ctx);

    await expect(caller.auth.login({ password: "errada" })).rejects.toThrow(/senha incorreta/i);
    expect(cookies).toHaveLength(0);
  });

  it("bloqueia o IP após tentativas repetidas", async () => {
    const ip = "10.0.0.2";

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { ctx } = createContext(ip);
      await expect(
        appRouter.createCaller(ctx).auth.login({ password: "errada" })
      ).rejects.toThrow();
    }

    // A partir daqui nem a senha correta passa, até o bloqueio expirar.
    const { ctx, cookies } = createContext(ip);
    await expect(
      appRouter.createCaller(ctx).auth.login({ password: PASSWORD })
    ).rejects.toThrow(/muitas tentativas/i);
    expect(cookies).toHaveLength(0);
  });
});
