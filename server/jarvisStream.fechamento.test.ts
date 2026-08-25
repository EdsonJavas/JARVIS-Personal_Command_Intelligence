import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";

/**
 * O fluxo tem que FECHAR quando a execução termina.
 *
 * Este arquivo existe por causa de um defeito real: o servidor nunca encerrava a
 * resposta e o cliente nunca abortava o `fetch`, então cada mensagem deixava uma
 * conexão viva e um keepalive pulsando. O navegador só mantém seis conexões por
 * host — na sétima mensagem o Jarvis parava de responder, sem erro nenhum na
 * tela. Nenhum teste pegava isso porque todos paravam no primeiro turno.
 *
 * Fica separado do jarvisStream.test.ts porque precisa de autenticação e de
 * provedor falsos, e aquele arquivo testa justamente as travas de entrada de
 * verdade.
 */

vi.mock("./auth", () => ({
  authenticateRequest: async () => ({ id: 1, openId: "dono" }),
}));

vi.mock("./jarvis/turno", () => ({
  prepararTurno: async () => ({ relatorioDaMaquina: "", memorias: "", usadas: [] }),
  concluirTurno: () => {},
}));

vi.mock("./jarvisAi", () => ({
  JarvisProviderError: class extends Error {
    kind = "provider_failure";
  },
  generateJarvisReply: async () => ({
    reply: "Pronto, Senhor.",
    fala: "Pronto, Senhor.",
    model: "modelo-de-teste",
    actions: [],
    motivoDeParada: "concluido" as const,
  }),
}));

let servidor: Server;
let base: string;

beforeAll(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "segredo-de-teste-suficientemente-longo";
  const { jarvisStreamRouter } = await import("./jarvisStream");

  const app = express();
  app.use(express.json());
  app.use("/api/jarvis", jarvisStreamRouter);

  await new Promise<void>((resolve) => {
    servidor = app.listen(0, () => resolve());
  });
  const endereco = servidor.address();
  base = `http://127.0.0.1:${typeof endereco === "object" && endereco ? endereco.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
});

/**
 * Lê o corpo até o fim com prazo.
 *
 * O prazo é o teste em si: se o servidor não fechar, `text()` nunca resolve. Sem
 * a corrida, o defeito apareceria como suíte travada em vez de teste vermelho.
 */
async function lerAteOFimComPrazo(resposta: Response, prazoMs = 5000): Promise<string> {
  let temporizador: NodeJS.Timeout;
  const expirar = new Promise<never>((_, rejeitar) => {
    temporizador = setTimeout(
      () => rejeitar(new Error("o servidor não fechou o fluxo dentro do prazo")),
      prazoMs
    );
  });

  try {
    return await Promise.race([resposta.text(), expirar]);
  } finally {
    clearTimeout(temporizador!);
  }
}

function abrirFluxo(corpo: unknown) {
  return fetch(`${base}/api/jarvis/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

describe("fechamento do fluxo", () => {
  it("fecha a resposta assim que o evento terminal sai", async () => {
    const resposta = await abrirFluxo({
      modo: "novo",
      mensagens: [{ role: "user", content: "bom dia" }],
    });

    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("content-type")).toContain("event-stream");

    const texto = await lerAteOFimComPrazo(resposta);

    expect(texto).toContain("event: resposta");
    // O quadro de fim é o que diz ao cliente que não vem mais nada.
    expect(texto).toContain("event: fim");
  });

  it("dez turnos seguidos não deixam conexão pendurada", async () => {
    // O defeito só aparecia a partir do sétimo turno, quando o navegador bate no
    // teto de seis conexões por host. Dez dá margem.
    for (let turno = 0; turno < 10; turno += 1) {
      const resposta = await abrirFluxo({
        modo: "novo",
        mensagens: [{ role: "user", content: `pedido ${turno}` }],
      });
      const texto = await lerAteOFimComPrazo(resposta);
      expect(texto, `turno ${turno} não fechou`).toContain("event: fim");
    }
  });

  it("retomar execução desconhecida fecha em vez de pendurar", async () => {
    const resposta = await abrirFluxo({ modo: "retomar", execucaoId: "nao-existe", desdeSeq: 0 });
    const texto = await lerAteOFimComPrazo(resposta);

    expect(texto).toContain("execucao_desconhecida");
    expect(texto).toContain("event: fim");
  });
});
