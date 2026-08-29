import {
  quadroDeAudio,
  quadroDeFimDeAudio,
  quadroDeResultado,
  quadroDeSetup,
  quadroDeTexto,
  type OpcoesDeSetup,
  type QuadroDoGoogle,
} from "./protocoloLive";

/**
 * A conversa fala↔fala com o Gemini, por WebSocket.
 *
 * Sem SDK, e de propósito: o `@google/genai` embrulha justamente os quadros que
 * esta ponte precisa manipular à mão — `toolCall`, `interrupted`, `goAway` — e
 * traz um cliente HTTP inteiro junto. O `WebSocket` global do Node 24 fala o
 * protocolo direto.
 *
 * Este módulo não sabe nada sobre ferramentas, execuções ou o navegador: ele
 * abre, mantém, traduz e avisa. Quem decide o que fazer é `sessaoAoVivo`.
 */

const URL_BASE =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

const PRAZO_DE_SETUP_MS = 15_000;

export type EventosDaLive = {
  pronta: () => void;
  audio: (pcm: Buffer) => void;
  transcricao: (de: "dono" | "jarvis", texto: string) => void;
  ferramentas: (
    chamadas: { id?: string; name: string; args: Record<string, unknown> }[]
  ) => void;
  interrompido: () => void;
  turnoCompleto: () => void;
  /** O Google avisou que vai encerrar: hora de religar com o handle. */
  vaiEncerrar: (handle: string | null) => void;
  fechou: (codigo: number, motivo: string) => void;
  erro: (erro: Error) => void;
};

export type ClienteLive = {
  enviarAudio: (pcm: Buffer) => void;
  fimDoAudio: () => void;
  enviarTexto: (texto: string) => void;
  responderFerramentas: (r: { id?: string; name: string; resultado: string }[]) => void;
  /** O último handle de retomada recebido, para religar sem o dono notar. */
  handleDeRetomada: () => string | null;
  fechar: () => void;
  aberta: () => boolean;
};

export function abrirLive(
  chave: string,
  setup: OpcoesDeSetup,
  eventos: Partial<EventosDaLive>
): ClienteLive {
  const ws = new WebSocket(`${URL_BASE}?key=${encodeURIComponent(chave)}`);
  let pronta = false;
  let handle: string | null = null;
  let fechada = false;

  const prazo = setTimeout(() => {
    if (!pronta) {
      eventos.erro?.(new Error(`a Live não respondeu em ${PRAZO_DE_SETUP_MS / 1000}s`));
      try {
        ws.close();
      } catch {
        /* já estava fechando */
      }
    }
  }, PRAZO_DE_SETUP_MS);

  const enviar = (quadro: string) => {
    // `readyState` e não só `pronta`: áudio enviado antes do `setupComplete` é
    // descartado pelo Google, e depois do fechamento estoura.
    if (ws.readyState === WebSocket.OPEN) ws.send(quadro);
  };

  ws.onopen = () => enviar(quadroDeSetup(setup));

  ws.onmessage = async (evento: MessageEvent) => {
    let quadro: QuadroDoGoogle;
    try {
      const cru =
        typeof evento.data === "string" ? evento.data : await (evento.data as Blob).text();
      quadro = JSON.parse(cru) as QuadroDoGoogle;
    } catch {
      // Quadro ilegível: ignorar é melhor que derrubar a conversa inteira.
      return;
    }

    if (quadro.setupComplete) {
      pronta = true;
      clearTimeout(prazo);
      eventos.pronta?.();
      return;
    }

    if (quadro.sessionResumptionUpdate?.newHandle) {
      handle = quadro.sessionResumptionUpdate.newHandle;
      return;
    }

    if (quadro.goAway) {
      eventos.vaiEncerrar?.(handle);
      return;
    }

    if (quadro.toolCall?.functionCalls?.length) {
      eventos.ferramentas?.(
        quadro.toolCall.functionCalls.map((c) => ({ id: c.id, name: c.name, args: c.args ?? {} }))
      );
      return;
    }

    const conteudo = quadro.serverContent;
    if (!conteudo) return;

    if (conteudo.interrupted) {
      eventos.interrompido?.();
      return;
    }
    if (conteudo.inputTranscription?.text) {
      eventos.transcricao?.("dono", conteudo.inputTranscription.text);
    }
    if (conteudo.outputTranscription?.text) {
      eventos.transcricao?.("jarvis", conteudo.outputTranscription.text);
    }
    for (const parte of conteudo.modelTurn?.parts ?? []) {
      if (parte.inlineData?.data) {
        eventos.audio?.(Buffer.from(parte.inlineData.data, "base64"));
      }
    }
    if (conteudo.turnComplete) eventos.turnoCompleto?.();
  };

  ws.onerror = () => eventos.erro?.(new Error("falha no canal com a Live"));
  ws.onclose = (e: CloseEvent) => {
    clearTimeout(prazo);
    fechada = true;
    eventos.fechou?.(e.code, String(e.reason ?? ""));
  };

  return {
    enviarAudio: (pcm) => enviar(quadroDeAudio(pcm)),
    fimDoAudio: () => enviar(quadroDeFimDeAudio()),
    enviarTexto: (texto) => enviar(quadroDeTexto(texto)),
    responderFerramentas: (r) => enviar(quadroDeResultado(r)),
    handleDeRetomada: () => handle,
    fechar: () => {
      try {
        ws.close();
      } catch {
        /* já fechada */
      }
    },
    aberta: () => !fechada && ws.readyState === WebSocket.OPEN,
  };
}
