import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import { CAMINHO_VOZ_AO_VIVO } from "@shared/vozAoVivo";
import { authenticateRequest } from "../auth";
import { abrirSessaoAoVivo, type SessaoAoVivo } from "./sessaoAoVivo";

/**
 * O ponto de entrada do modo de voz ao vivo.
 *
 * `noServer: true` porque o servidor HTTP já tem outro dono do evento
 * `upgrade`: o HMR do Vite. Ele só trata o upgrade cujo protocolo é dele e não
 * destrói os demais, então os dois convivem — desde que este também trate
 * apenas o próprio caminho e ignore o resto em silêncio.
 */

const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
const sessoes = new Map<number, SessaoAoVivo>();

/**
 * WebSocket não é protegido por CORS.
 *
 * Sem esta checagem, qualquer página aberta noutra aba abriria um canal
 * autenticado pelo cookie do dono — com as 32 ferramentas do outro lado. A
 * regra é a mesma do fluxo SSE: origem ausente é mesma origem; presente, o
 * host tem que bater.
 */
function origemConfiavel(req: IncomingMessage): boolean {
  const origem = req.headers.origin;
  if (!origem) return true;
  try {
    return new URL(origem).host === req.headers.host;
  } catch {
    return false;
  }
}

function recusar(socket: Duplex, codigo: number, texto: string): void {
  socket.write(`HTTP/1.1 ${codigo} ${texto}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function ligarVozAoVivo(server: Server): void {
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, cabeca: Buffer) => {
    // Só o nosso caminho. Qualquer outro é de outro dono (o HMR do Vite).
    let caminho: string;
    try {
      caminho = new URL(req.url ?? "/", `http://${req.headers.host}`).pathname;
    } catch {
      return;
    }
    if (caminho !== CAMINHO_VOZ_AO_VIVO) return;

    if (!origemConfiavel(req)) return recusar(socket, 403, "Forbidden");

    const chave = process.env.LLM_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim();
    if (!chave) return recusar(socket, 503, "Service Unavailable");

    /*
     * `authenticateRequest` lê apenas `req.headers.cookie`, então funciona no
     * `IncomingMessage` cru do upgrade, sem adaptador de Express.
     */
    void authenticateRequest(req as never)
      .then((usuario) => {
        if (!usuario) return recusar(socket, 401, "Unauthorized");

        wss.handleUpgrade(req, socket, cabeca, (ws) => {
          // Uma sessão por dono, como já é uma execução por dono.
          sessoes.get(usuario.id)?.encerrar();

          void abrirSessaoAoVivo(ws, usuario.id, chave)
            .then((sessao) => {
              sessoes.set(usuario.id, sessao);
              ws.on("close", () => {
                if (sessoes.get(usuario.id) === sessao) sessoes.delete(usuario.id);
              });
            })
            .catch((erro) => {
              console.warn("[VozAoVivo] não abriu:", String(erro).slice(0, 160));
              try {
                ws.close();
              } catch {
                /* já fechado */
              }
            });
        });
      })
      .catch(() => recusar(socket, 401, "Unauthorized"));
  });

  console.log(`[VozAoVivo] escutando em ${CAMINHO_VOZ_AO_VIVO}`);
}

/** Chamado no desligamento, para não deixar sessão nem processo filho órfão. */
export function encerrarSessoesAoVivo(): void {
  for (const sessao of sessoes.values()) sessao.encerrar();
  sessoes.clear();
}
