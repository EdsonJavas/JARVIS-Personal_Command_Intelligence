import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { jarvisStreamRouter } from "./jarvisStream";

/**
 * Travas de entrada da rota de fluxo.
 *
 * É um POST autenticado por cookie que executa PowerShell: as checagens de
 * sessão e de origem são a diferença entre uma ferramenta pessoal e uma porta
 * aberta para qualquer página que o dono visite.
 */

let servidor: Server;
let base: string;

beforeAll(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "segredo-de-teste-suficientemente-longo";

  const app = express();
  app.use(express.json());
  app.use("/api/jarvis", jarvisStreamRouter);

  await new Promise<void>((resolve) => {
    // Porta zero: o sistema escolhe uma livre e não há risco de colidir com o
    // servidor de desenvolvimento.
    servidor = app.listen(0, () => resolve());
  });

  const endereco = servidor.address();
  const porta = typeof endereco === "object" && endereco ? endereco.port : 0;
  base = `http://127.0.0.1:${porta}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
});

describe("rota de fluxo do Jarvis", () => {
  it("sem sessão devolve 401 em JSON, nunca um quadro SSE", async () => {
    // Se respondesse 200 com quadro de erro, o cliente não teria como saber que
    // precisa mandar o dono fazer login de novo.
    const resposta = await fetch(`${base}/api/jarvis/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modo: "novo", mensagens: [] }),
    });

    expect(resposta.status).toBe(401);
    expect(resposta.headers.get("content-type")).toContain("application/json");
    expect(resposta.headers.get("content-type")).not.toContain("event-stream");

    const corpo = await resposta.json();
    expect(corpo.erro).toBe("nao_autenticado");
  });

  it("cancelar sem sessão devolve 401", async () => {
    const resposta = await fetch(`${base}/api/jarvis/execucao/qualquer/cancelar`, {
      method: "POST",
    });
    expect(resposta.status).toBe(401);
  });

  it("ler execução sem sessão devolve 401", async () => {
    const resposta = await fetch(`${base}/api/jarvis/execucao/qualquer`);
    expect(resposta.status).toBe(401);
  });

  it("a checagem de sessão vem antes da de origem", async () => {
    // A ordem importa: vazar "origem recusada" para quem não está autenticado
    // contaria a um terceiro que a rota existe e como ela se comporta.
    const resposta = await fetch(`${base}/api/jarvis/stream`, {
      method: "POST",
      headers: { "content-type": "text/plain", origin: "https://malicioso.exemplo" },
      body: "{}",
    });
    expect(resposta.status).toBe(401);
  });
});
