import { useEffect, useRef } from "react";
import { useJarvisSession, type CoreState } from "@/contexts/JarvisSessionContext";

/**
 * Os dois instrumentos pequenos da ilha: o orbe e as barras.
 *
 * Os dois desenham fora do React, lendo refs a cada quadro. A voz atualiza o
 * pulso sessenta vezes por segundo; passar isso por estado faria a ilha inteira
 * renderizar sessenta vezes por segundo, incluindo a conversa aberta.
 */

const AZUL = "120, 200, 255";

/** Quanto o estado acende o orbe, de 0 a 1. Mesma régua do núcleo da Ponte. */
function alvoDeIntensidade(
  estado: CoreState,
  pulso: number,
  microfone: number,
  quadro: number
): number {
  if (estado === "speaking") return pulso;
  if (estado === "listening") return microfone;
  if (estado === "thinking") return 0.45 + Math.sin(quadro * 0.08) * 0.2;
  return 0.1;
}

/**
 * O núcleo do Jarvis em miniatura: dois arcos que giram e um miolo que acende.
 *
 * Mesma cor em todos os estados, como na Ponte. O que muda é ritmo e brilho.
 */
export function OrbeIlha({ tamanho }: { tamanho: number }) {
  const { coreState, micLevelRef, voice } = useJarvisSession();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const estadoRef = useRef(coreState);
  estadoRef.current = coreState;
  const pulsoRef = voice.speechPulseRef;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = tamanho * dpr;
    canvas.height = tamanho * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let quadro = 0;
    let fase = 0;
    let intensidade = 0.1;
    let animacao = 0;

    const desenhar = () => {
      const estado = estadoRef.current;
      const alvo = alvoDeIntensidade(estado, pulsoRef.current ?? 0, micLevelRef.current ?? 0, quadro);
      intensidade += (alvo - intensidade) * 0.2;
      fase += estado === "thinking" ? 0.07 : 0.025;

      const c = tamanho / 2;
      ctx.clearRect(0, 0, tamanho, tamanho);

      const arco = (raio: number, giro: number, fracao: number, alfa: number, largura: number) => {
        ctx.beginPath();
        ctx.arc(c, c, raio, fase * giro, fase * giro + Math.PI * 2 * fracao);
        ctx.strokeStyle = `rgba(${AZUL}, ${alfa})`;
        ctx.lineWidth = largura;
        ctx.lineCap = "round";
        ctx.stroke();
      };

      arco(c - 1.5, 1, 0.62, 0.35 + intensidade * 0.5, 1.4);
      arco(c * 0.62, -1.6, 0.4, 0.3 + intensidade * 0.5, 1.2);

      const miolo = c * (0.24 + intensidade * 0.16);
      const brilho = ctx.createRadialGradient(c, c, 0, c, c, miolo * 2.2);
      brilho.addColorStop(0, `rgba(${AZUL}, ${0.75 + intensidade * 0.25})`);
      brilho.addColorStop(0.5, `rgba(${AZUL}, ${0.18 + intensidade * 0.25})`);
      brilho.addColorStop(1, `rgba(${AZUL}, 0)`);
      ctx.beginPath();
      ctx.arc(c, c, miolo * 2.2, 0, Math.PI * 2);
      ctx.fillStyle = brilho;
      ctx.fill();

      quadro += 1;
      animacao = requestAnimationFrame(desenhar);
    };

    animacao = requestAnimationFrame(desenhar);
    return () => cancelAnimationFrame(animacao);
  }, [tamanho, micLevelRef, pulsoRef]);

  return (
    <canvas
      ref={canvasRef}
      className="ilha-orbe"
      style={{ width: tamanho, height: tamanho }}
      aria-hidden="true"
    />
  );
}

const BARRAS = 5;

/**
 * Barras de nível: a voz dele quando fala, o microfone quando ouve.
 *
 * Mexe em `transform` direto no elemento: só composição, sem layout, e nenhum
 * render do React por quadro.
 */
export function BarrasIlha() {
  const { coreState, micLevelRef, voice } = useJarvisSession();
  const barrasRef = useRef<Array<HTMLSpanElement | null>>([]);
  const estadoRef = useRef(coreState);
  estadoRef.current = coreState;
  const ondaRef = voice.speechWaveRef;
  const pulsoRef = voice.speechPulseRef;

  useEffect(() => {
    const suavizadas = new Array<number>(BARRAS).fill(0.15);
    let quadro = 0;
    let animacao = 0;

    const desenhar = () => {
      const estado = estadoRef.current;
      const onda = ondaRef.current;
      for (let i = 0; i < BARRAS; i += 1) {
        let alvo: number;
        if (estado === "speaking" && onda) {
          // Amostras espalhadas pela forma de onda, centradas em 128.
          const amostra = onda[Math.floor(((i + 0.5) / BARRAS) * onda.length)] ?? 128;
          alvo = Math.min(1, Math.abs(amostra - 128) / 48 + (pulsoRef.current ?? 0) * 0.6);
        } else if (estado === "listening") {
          const nivel = micLevelRef.current ?? 0;
          alvo = Math.min(1, nivel * (0.7 + 0.5 * Math.sin(quadro * 0.21 + i * 1.7)));
        } else {
          alvo = 0.18 + 0.12 * Math.sin(quadro * 0.09 + i * 0.9);
        }
        suavizadas[i] += (Math.max(0.15, alvo) - suavizadas[i]) * 0.35;
        const barra = barrasRef.current[i];
        if (barra) barra.style.transform = `scaleY(${suavizadas[i].toFixed(3)})`;
      }
      quadro += 1;
      animacao = requestAnimationFrame(desenhar);
    };

    animacao = requestAnimationFrame(desenhar);
    return () => cancelAnimationFrame(animacao);
  }, [micLevelRef, ondaRef, pulsoRef]);

  return (
    <span className="ilha-barras" aria-hidden="true">
      {Array.from({ length: BARRAS }, (_, i) => (
        <span
          key={i}
          ref={(no) => {
            barrasRef.current[i] = no;
          }}
        />
      ))}
    </span>
  );
}
