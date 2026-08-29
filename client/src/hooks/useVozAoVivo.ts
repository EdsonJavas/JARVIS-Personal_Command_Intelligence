import { useCallback, useEffect, useRef, useState } from "react";
import {
  AMOSTRAS_POR_QUADRO,
  CAMINHO_VOZ_AO_VIVO,
  TAXA_ENTRADA,
  type DoServidor,
} from "@shared/vozAoVivo";
import { criarFilaDeAudio, type FilaDeAudio } from "@/lib/filaDeAudio";

/**
 * A conversa por voz ao vivo, do lado do navegador.
 *
 * Captura o microfone em PCM e toca o que volta, sem TTS no meio. O que a
 * interface já desenha — o núcleo, a onda, o cartão de confirmação — continua
 * funcionando porque este hook alimenta as MESMAS refs que a voz antiga
 * alimentava, e porque a pergunta continua vindo pelo SSE de sempre.
 */

const TETO_DE_FILA = 512 * 1024;

export type OpcoesDaVozAoVivo = {
  ondaRef: React.RefObject<Uint8Array>;
  pulsoRef: React.RefObject<number>;
  micLevelRef: React.RefObject<number>;
  aoTranscrever?: (de: "dono" | "jarvis", texto: string) => void;
  aoErro?: (mensagem: string) => void;
};

export function useVozAoVivo(opcoes: OpcoesDaVozAoVivo) {
  const [ativo, setAtivo] = useState(false);
  const [conectando, setConectando] = useState(false);
  const [falando, setFalando] = useState(false);
  const [microfoneBloqueado, setMicrofoneBloqueado] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const ctxEntradaRef = useRef<AudioContext | null>(null);
  const ctxSaidaRef = useRef<AudioContext | null>(null);
  const filaRef = useRef<FilaDeAudio | null>(null);
  const faixasRef = useRef<MediaStreamTrack[]>([]);
  const noRef = useRef<AudioWorkletNode | null>(null);
  const quadroRef = useRef<number | null>(null);
  const opcoesRef = useRef(opcoes);
  opcoesRef.current = opcoes;

  /** Meio-duplex: enquanto ele fala, o microfone não sobe. Ver `parar`. */
  const meioDuplexRef = useRef(true);
  const falandoRef = useRef(false);

  const parar = useCallback(() => {
    quadroRef.current !== null && cancelAnimationFrame(quadroRef.current);
    quadroRef.current = null;

    noRef.current?.port.postMessage("parar");
    noRef.current?.disconnect();
    noRef.current = null;

    for (const faixa of faixasRef.current) faixa.stop();
    faixasRef.current = [];

    filaRef.current?.encerrar();
    filaRef.current = null;

    // Fechar os dois contextos: alguns Windows param de reproduzir em silêncio
    // depois de meia dúzia de contextos vazados.
    void ctxEntradaRef.current?.close().catch(() => {});
    void ctxSaidaRef.current?.close().catch(() => {});
    ctxEntradaRef.current = null;
    ctxSaidaRef.current = null;

    const ws = wsRef.current;
    wsRef.current = null;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ t: "encerrar" }));
      ws.close();
    }

    opcoesRef.current.pulsoRef.current = 0;
    opcoesRef.current.ondaRef.current?.fill(128);
    opcoesRef.current.micLevelRef.current = 0;
    falandoRef.current = false;
    setFalando(false);
    setAtivo(false);
    setConectando(false);
    setMicrofoneBloqueado(false);
  }, []);

  const iniciar = useCallback(async () => {
    if (wsRef.current) return;
    setConectando(true);

    try {
      /*
       * Dois contextos, um por taxa. O de entrada nasce a 16 kHz para o Chrome
       * reamostrar em código nativo; o de saída a 24 kHz, que é o que a Live
       * devolve. Compartilhar um só obrigaria a reamostrar em JS dos dois lados.
       */
      const ctxSaida = new AudioContext({ sampleRate: 24_000, latencyHint: "interactive" });
      // `resume` dentro do gesto do dono: fora dele o navegador recusa.
      await ctxSaida.resume();
      ctxSaidaRef.current = ctxSaida;

      const analisador = ctxSaida.createAnalyser();
      analisador.fftSize = 512;
      analisador.smoothingTimeConstant = 0.7;
      analisador.connect(ctxSaida.destination);
      filaRef.current = criarFilaDeAudio(ctxSaida, analisador);

      // A onda e o pulso vêm do áudio REAL, como na voz antiga.
      const amostras = new Uint8Array(analisador.frequencyBinCount);
      const medir = () => {
        analisador.getByteTimeDomainData(amostras);
        let soma = 0;
        for (let i = 0; i < amostras.length; i += 1) {
          const desvio = (amostras[i] - 128) / 128;
          soma += desvio * desvio;
        }
        opcoesRef.current.pulsoRef.current = Math.min(1, Math.sqrt(soma / amostras.length) * 3.4);

        const onda = opcoesRef.current.ondaRef.current;
        if (onda) {
          const passo = amostras.length / onda.length;
          for (let i = 0; i < onda.length; i += 1) onda[i] = amostras[Math.floor(i * passo)];
        }
        quadroRef.current = requestAnimationFrame(medir);
      };
      quadroRef.current = requestAnimationFrame(medir);

      const fluxo = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      faixasRef.current = fluxo.getTracks();

      const ctxEntrada = new AudioContext({ sampleRate: TAXA_ENTRADA, latencyHint: "interactive" });
      await ctxEntrada.resume();
      ctxEntradaRef.current = ctxEntrada;
      await ctxEntrada.audioWorklet.addModule("/worklets/captura-pcm.js");

      const no = new AudioWorkletNode(ctxEntrada, "captura-pcm", {
        processorOptions: { taxaAlvo: TAXA_ENTRADA, amostrasPorBloco: AMOSTRAS_POR_QUADRO },
      });
      ctxEntrada.createMediaStreamSource(fluxo).connect(no);
      noRef.current = no;

      const protocolo = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocolo}//${location.host}${CAMINHO_VOZ_AO_VIVO}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      no.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
        opcoesRef.current.micLevelRef.current = Math.min(1, e.data.rms * 4);
        if (ws.readyState !== WebSocket.OPEN) return;
        // Meio-duplex: enquanto ele fala, não subimos áudio. Sem isso, com
        // alto-falante aberto, o VAD do Google ouve o próprio JARVIS e o
        // interrompe sem parar — ele começa a falar e se corta sozinho.
        if (meioDuplexRef.current && falandoRef.current) return;
        // Áudio ao vivo enfileirado é áudio velho: entregá-lo tarde é pior que
        // perdê-lo.
        if (ws.bufferedAmount > TETO_DE_FILA) return;
        ws.send(e.data.pcm);
      };

      ws.onmessage = (evento: MessageEvent) => {
        if (evento.data instanceof ArrayBuffer) {
          filaRef.current?.enfileirar(new Int16Array(evento.data));
          if (!falandoRef.current) {
            falandoRef.current = true;
            setFalando(true);
          }
          return;
        }
        let m: DoServidor;
        try {
          m = JSON.parse(String(evento.data)) as DoServidor;
        } catch {
          return;
        }
        if (m.t === "pronta") {
          setConectando(false);
          setAtivo(true);
        } else if (m.t === "transcricao") {
          opcoesRef.current.aoTranscrever?.(m.de, m.texto);
        } else if (m.t === "interrompido") {
          filaRef.current?.descartar();
          falandoRef.current = false;
          setFalando(false);
        } else if (m.t === "falando") {
          falandoRef.current = m.ativo;
          setFalando(m.ativo);
        } else if (m.t === "microfone") {
          setMicrofoneBloqueado(m.bloqueado);
        } else if (m.t === "erro") {
          opcoesRef.current.aoErro?.(m.mensagem);
          parar();
        }
      };

      ws.onclose = () => parar();
      ws.onerror = () => {
        opcoesRef.current.aoErro?.("A conversa por voz caiu.");
        parar();
      };
    } catch (erro) {
      opcoesRef.current.aoErro?.(
        erro instanceof DOMException && erro.name === "NotAllowedError"
          ? "Preciso do microfone para conversar. Autorize no navegador."
          : `Não consegui abrir a voz ao vivo: ${String(erro).slice(0, 120)}`
      );
      parar();
    }
  }, [parar]);

  /** Caixa de texto durante o modo ao vivo: ele responde falando. */
  const enviarTexto = useCallback((conteudo: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "texto", conteudo }));
  }, []);

  useEffect(() => parar, [parar]);

  return {
    ativo,
    conectando,
    falando,
    microfoneBloqueado,
    iniciar,
    parar,
    enviarTexto,
    meioDuplex: meioDuplexRef,
  };
}
