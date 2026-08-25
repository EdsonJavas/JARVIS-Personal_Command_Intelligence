import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "../routers";
import { matarArvoreDeProcessos } from "../tools/shell";
import { jarvisStreamRouter } from "../jarvisStream";
import { cancelarTodasAsExecucoes } from "../execucoes";
import { createContext } from "./context";
import { aquecerVoz } from "../vozAquecimento";
import { ligarEntregaDeIniciativas } from "../tempo/entrega";
import { desligarServidoresMcp, ligarServidoresMcp } from "../mcp/arranque";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // Respeita X-Forwarded-* quando o app roda atrás de um proxy (VPS/Render),
  // para que req.ip e a detecção de https reflitam o cliente real.
  app.set("trust proxy", 1);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // O fluxo de eventos precisa vir ANTES do Vite: o middleware dele responde
  // index.html para qualquer rota não registrada, e o sintoma seria um fluxo
  // SSE entregando HTML.
  app.use("/api/jarvis", jarvisStreamRouter);
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);

    // Deixa prontas as frases com que ele anuncia cada ação: sem isto, a
    // primeira vez que ele diz "Vou medir a máquina" custa alguns segundos e a
    // voz chega depois da execução.
    aquecerVoz();

    // O relógio que faz o Jarvis procurar o dono sozinho — lembretes, rotinas e
    // vigias. Sem isto ele nunca abre a boca por conta própria.
    ligarEntregaDeIniciativas();

    // Agenda, e-mail e o que mais estiver plugado. Em segundo plano: um servidor
    // externo lento não pode atrasar o Jarvis ficar de pé.
    void ligarServidoresMcp();
  });
}

/**
 * Saída limpa.
 *
 * O Windows não mata processos netos quando o pai morre. Sem isto, cada
 * reinício do `tsx watch` durante o desenvolvimento deixa uma varredura
 * recursiva de disco girando sem dono — três salvamentos no meio de uma tarefa
 * longa deixam três varreduras concorrentes, e a máquina fica inutilizável.
 */
for (const sinal of ["SIGINT", "SIGTERM"] as const) {
  process.once(sinal, () => {
    cancelarTodasAsExecucoes("desligamento");
    const mortos = matarArvoreDeProcessos();
    if (mortos > 0) console.log(`[Saída] ${mortos} processo(s) encerrado(s).`);

    /*
     * Os servidores MCP são processos filhos: sem encerrá-los, cada reinício do
     * `tsx watch` deixa um `npx` órfão segurando memória e credencial. Com
     * prazo curto, porque a saída não pode ficar presa esperando integração.
     */
    void Promise.race([
      desligarServidoresMcp(),
      new Promise((resolver) => setTimeout(resolver, 1_500)),
    ]).finally(() => process.exit(0));
  });
}

startServer().catch(console.error);
