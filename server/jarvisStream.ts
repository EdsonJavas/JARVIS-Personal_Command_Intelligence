import { Router, type Request, type Response } from "express";
import type {
  EventoJarvis,
  IniciativaJarvis,
  MensagemDeFio,
  PedidoStream,
} from "@shared/jarvisStream";
import { ehTerminal, INTERVALO_KEEPALIVE_MS } from "@shared/jarvisStream";
import { authenticateRequest } from "./auth";
import {
  anexar,
  BOOT_ID,
  cancelar,
  desanexar,
  emitir,
  emitirBruto,
  iniciarExecucao,
  obter,
  sinalDe,
} from "./execucoes";
import { generateJarvisReply, JarvisProviderError } from "./jarvisAi";
import { concluirTurno, prepararTurno } from "./jarvis/turno";

/**
 * Transporte dos eventos do laço até a interface.
 *
 * SSE em rota Express própria, e não subscription do tRPC: o fluxo precisa
 * sobreviver a recarregamento de página com retomada por número de sequência, e
 * o `sendBeacon` do cancelamento ao fechar a aba só fala HTTP simples.
 */

export const jarvisStreamRouter = Router();

/** Escreve um quadro no formato do fio. */
export function escreverEvento(res: Response, evento: EventoJarvis): void {
  res.write(`id: ${evento.seq}\n`);
  res.write(`event: ${evento.tipo}\n`);
  res.write(`data: ${JSON.stringify(evento)}\n\n`);
}

/**
 * Confere que o pedido veio da própria aplicação.
 *
 * É um POST autenticado por cookie que executa PowerShell: sem esta checagem,
 * um formulário em outro site conseguiria dispará-lo. Exigir JSON força o
 * preflight, e a origem tem que bater com o host.
 */
function origemConfiavel(req: Request): boolean {
  const tipo = String(req.headers["content-type"] ?? "");
  if (!tipo.includes("application/json")) return false;

  const origem = req.headers.origin;
  if (!origem) return true; // mesma origem não manda o cabeçalho

  try {
    return new URL(origem).host === req.headers.host;
  } catch {
    return false;
  }
}

function recusar(res: Response, status: number, codigo: string, mensagem: string) {
  // 401 precisa ser status HTTP com JSON, nunca 200 com quadro SSE: é o que
  // permite ao cliente disparar o fluxo de login.
  res.status(status).json({ erro: codigo, mensagem });
}

jarvisStreamRouter.post("/stream", async (req: Request, res: Response) => {
  const usuario = await authenticateRequest(req).catch(() => null);
  if (!usuario) {
    return recusar(res, 401, "nao_autenticado", "Sessão inválida ou expirada.");
  }
  if (!origemConfiavel(req)) {
    return recusar(res, 403, "origem_recusada", "Pedido de origem não confiável.");
  }

  const pedido = req.body as PedidoStream;
  if (!pedido || (pedido.modo !== "novo" && pedido.modo !== "retomar")) {
    return recusar(res, 400, "pedido_invalido", "Modo do pedido ausente ou desconhecido.");
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    // Impede que proxies segurem o fluxo em buffer até o fim.
    "x-accel-buffering": "no",
  });
  res.flushHeaders?.();
  req.socket.setNoDelay(true);

  let execucaoId: string | null = null;
  let fechado = false;

  const pulsar = setInterval(() => {
    // Comentário SSE: mantém a conexão viva sem consumir número de sequência.
    res.write(": ping\n\n");
  }, INTERVALO_KEEPALIVE_MS);
  pulsar.unref?.();

  /**
   * Fecha o fluxo de uma vez só.
   *
   * Idempotente porque as causas de fim — evento terminal, aba fechada, conexão
   * caída — podem chegar juntas, e escrever depois do `end` estoura. Vale também
   * para as saídas antecipadas: antes, a retomada de execução já terminada saía
   * por `return res.end()` sem nunca ter registrado o desanexar, e o ouvinte
   * ficava preso no registro.
   */
  const finalizar = () => {
    if (fechado) return;
    fechado = true;
    clearInterval(pulsar);
    if (execucaoId) desanexar(execucaoId, ouvinte);
    if (!res.writableEnded) {
      res.write("event: fim\ndata: {}\n\n");
      res.end();
    }
  };

  /**
   * O fluxo TEM que ser fechado no evento terminal.
   *
   * Sem isto a resposta ficava aberta para sempre: o `fetch` do cliente seguia
   * preso em `read()`, o keepalive continuava pulsando, e cada mensagem deixava
   * uma conexão viva. O navegador só mantém seis por host — na sétima mensagem
   * o Jarvis simplesmente parava de responder, sem erro nenhum na tela.
   */
  const ouvinte = (evento: EventoJarvis) => {
    escreverEvento(res, evento);
    if (ehTerminal(evento)) finalizar();
  };

  // Registrados agora, antes de qualquer saída antecipada.
  req.on("close", finalizar);
  res.on("close", finalizar);

  if (pedido.modo === "retomar") {
    const resultado = anexar(pedido.execucaoId, pedido.desdeSeq ?? 0, ouvinte, usuario.id);
    if (!resultado.ok) {
      escreverEvento(res, {
        tipo: "erro",
        seq: 0,
        em: Date.now(),
        codigo: "execucao_desconhecida",
        mensagem: "A execução não existe mais neste servidor.",
        recuperavel: false,
      });
      return finalizar();
    }

    execucaoId = resultado.execucao.id;
    for (const atrasado of resultado.atrasados) escreverEvento(res, atrasado);

    if (resultado.execucao.estado === "terminada") {
      return finalizar();
    }
  } else {
    const execucao = iniciarExecucao({
      usuarioId: usuario.id,
      mensagens: pedido.mensagens ?? [],
    });
    execucaoId = execucao.id;
    anexar(execucaoId, 0, ouvinte, usuario.id);

    emitir(execucaoId, {
      tipo: "inicio",
      execucaoId,
      modelo: process.env.LLM_MODEL?.trim() || "gemini-3.6-flash",
      bootId: BOOT_ID,
    });

    // O laço roda desacoplado da conexão: fechar a aba não o interrompe, quem
    // interrompe é o cancelamento explícito ou o fim da carência de órfã.
    void executar(execucaoId, pedido.mensagens ?? []);
  }

  // Se a execução já terminou entre o anexar e aqui, o evento terminal pode ter
  // passado antes do ouvinte existir; fechar agora evita a conexão pendurada.
  if (execucaoId && obter(execucaoId, usuario.id)?.estado === "terminada") finalizar();
});

/** Cancelamento. Aceita `sendBeacon`, que é o que sobrevive ao fechar a aba. */
jarvisStreamRouter.post("/execucao/:id/cancelar", async (req: Request, res: Response) => {
  const usuario = await authenticateRequest(req).catch(() => null);
  if (!usuario) return res.status(401).end();

  const execucao = obter(req.params.id, usuario.id);
  if (!execucao) return res.status(204).end();

  cancelar(execucao.id, "usuario");
  return res.status(204).end();
});

/** Leitura do histórico de eventos, para quem preferir não abrir fluxo. */
jarvisStreamRouter.get("/execucao/:id", async (req: Request, res: Response) => {
  const usuario = await authenticateRequest(req).catch(() => null);
  if (!usuario) return res.status(401).json({ erro: "nao_autenticado" });

  const execucao = obter(req.params.id, usuario.id);
  if (!execucao) return res.status(404).json({ erro: "execucao_desconhecida" });

  return res.json({ eventos: execucao.eventos, estado: execucao.estado });
});

/** Conduz o laço, publicando cada evento no registro da execução. */
async function executar(execucaoId: string, mensagens: MensagemDeFio[]): Promise<void> {
  const sinal = sinalDe(execucaoId);

  try {
    const turno = await prepararTurno(mensagens);

    const resposta = await generateJarvisReply(mensagens as never, {
      relatorioDaMaquina: turno.relatorioDaMaquina,
      memorias: turno.memorias,
      aoEvento: (evento) => emitirBruto(execucaoId, evento),
      sinal,
      execucaoId,
      interativo: true,
    });

    if (resposta.motivoDeParada === "cancelado") return;

    // Memória que ajudou sobe na disputa por espaço nas próximas conversas.
    concluirTurno({ usadas: turno.usadas });

    emitir(execucaoId, {
      tipo: "resposta",
      texto: resposta.reply,
      fala: resposta.fala,
      modelo: resposta.model,
      motivoDeParada: resposta.motivoDeParada,
      acoes: resposta.actions,
    });
  } catch (error) {
    if (sinal.aborted) return;

    const codigo =
      error instanceof JarvisProviderError ? error.kind : ("interno" as const);
    const mensagem =
      error instanceof Error ? error.message : "Falha inesperada durante a execução.";

    emitir(execucaoId, {
      tipo: "erro",
      codigo,
      mensagem,
      // Cota e indisponibilidade valem nova tentativa; chave ausente, não.
      recuperavel: codigo === "quota_exceeded" || codigo === "provider_failure",
    });
  }
}

/* ------------------------------------------------------------------ *
 * Fluxo das iniciativas
 * ------------------------------------------------------------------ */

/**
 * Quem está com a tela aberta agora.
 *
 * Separado do registro de execuções de propósito: uma iniciativa nasce do
 * relógio, não de um pedido, e pode chegar quando não há execução nenhuma
 * acontecendo. Amarrá-la a uma execução faria o lembrete das 15h só existir se
 * o dono já estivesse conversando às 15h.
 */
const telasAbertas = new Set<Response>();

export function anunciarIniciativa(iniciativa: IniciativaJarvis): number {
  let entregues = 0;
  for (const res of telasAbertas) {
    try {
      res.write(`event: iniciativa\ndata: ${JSON.stringify(iniciativa)}\n\n`);
      entregues += 1;
    } catch {
      /* conexão morta: o próprio 'close' a remove */
    }
  }
  return entregues;
}

jarvisStreamRouter.get("/iniciativas", async (req: Request, res: Response) => {
  const usuario = await authenticateRequest(req).catch(() => null);
  if (!usuario) return recusar(res, 401, "nao_autenticado", "Sessão inválida ou expirada.");

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.flushHeaders?.();
  req.socket.setNoDelay(true);

  telasAbertas.add(res);

  // Este fluxo fica aberto o dia inteiro, então o keepalive não é opcional:
  // sem ele, qualquer proxy ou o próprio sistema derruba a conexão ociosa.
  const pulsar = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      /* será limpo no close */
    }
  }, INTERVALO_KEEPALIVE_MS);
  pulsar.unref?.();

  const encerrar = () => {
    clearInterval(pulsar);
    telasAbertas.delete(res);
  };

  req.on("close", encerrar);
  res.on("close", encerrar);
});
