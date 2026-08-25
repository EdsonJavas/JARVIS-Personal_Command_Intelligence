import { useEffect, useRef } from "react";
import { useJarvisSession } from "@/contexts/JarvisSessionContext";

/**
 * O núcleo do JARVIS 2.0.
 *
 * Substitui o cérebro de filamentos por uma leitura de instrumento: anéis
 * concêntricos, marcas de escala e um miolo que respira. É a linguagem das
 * primeiras aparições dele — azul de HUD, geométrico, discreto — e não a massa
 * orgânica que ocupava a tela inteira.
 *
 * A COR NÃO MUDA quando ele fala. Antes, cada estado tinha o seu matiz e a tela
 * piscava de cor a cada frase, o que cansa e não informa nada: o dono já sabe
 * que ele está falando, porque está ouvindo. O que muda é a INTENSIDADE e o
 * ritmo — o núcleo acelera pensando e pulsa com a voz, sempre no mesmo azul.
 */

/** Azul dos primeiros filmes. Único, em todos os estados. */
const AZUL = { r: 120, g: 200, b: 255 };

type Anel = {
  raio: number;
  espessura: number;
  /** Voltas por segundo. Negativo gira ao contrário. */
  giro: number;
  /** Fração do anel que é traço, de 0 a 1. */
  preenchimento: number;
  marcas: number;
};

/**
 * Os anéis.
 *
 * Giros em sentidos opostos e velocidades incomensuráveis: com velocidades
 * múltiplas, o conjunto reencontra a mesma posição a cada poucos segundos e a
 * imagem parece travar.
 */
const ANEIS: Anel[] = [
  { raio: 0.96, espessura: 1, giro: 0.014, preenchimento: 0.22, marcas: 48 },
  { raio: 0.82, espessura: 1.6, giro: -0.031, preenchimento: 0.55, marcas: 0 },
  { raio: 0.68, espessura: 1, giro: 0.047, preenchimento: 0.14, marcas: 24 },
  { raio: 0.5, espessura: 2.2, giro: -0.019, preenchimento: 0.72, marcas: 0 },
];

export function NucleoJarvis() {
  const { coreState, micLevelRef, voice } = useJarvisSession();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const estadoRef = useRef(coreState);

  // Por ref: o laço de desenho não pode depender de render do React, senão a
  // animação reinicia a cada tecla digitada na conversa.
  useEffect(() => {
    estadoRef.current = coreState;
  }, [coreState]);

  const vozRef = useRef(voice);
  useEffect(() => {
    vozRef.current = voice;
  }, [voice]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let quadro = 0;
    let fase = 0;
    /** Suavização: o valor cru salta e faz o núcleo tremer. */
    let intensidade = 0;

    const desenhar = () => {
      const lado = canvas.clientWidth;
      const dpr = Math.min(2, window.devicePixelRatio || 1);

      if (canvas.width !== lado * dpr) {
        canvas.width = lado * dpr;
        canvas.height = lado * dpr;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, lado, lado);

      const centro = lado / 2;
      const raioBase = lado * 0.42;
      const estado = estadoRef.current;

      /*
       * O que o estado muda é ritmo e brilho, nunca a cor.
       *
       * "pensando" acelera, "falando" pulsa com a voz, "ouvindo" respira com o
       * microfone. Em repouso, quase parado — presente sem chamar atenção.
       */
      const alvo =
        estado === "speaking"
          ? vozRef.current.speechPulseRef.current
          : estado === "listening"
            ? micLevelRef.current
            : estado === "thinking"
              ? 0.45 + Math.sin(quadro * 0.06) * 0.2
              : 0.12;

      intensidade += (alvo - intensidade) * 0.18;
      const velocidade = estado === "thinking" ? 2.4 : 1;
      fase += 0.016 * velocidade;

      const cor = (alfa: number) => `rgba(${AZUL.r}, ${AZUL.g}, ${AZUL.b}, ${alfa})`;

      for (const anel of ANEIS) {
        const raio = raioBase * anel.raio;
        const angulo = fase * anel.giro * 60;

        ctx.save();
        ctx.translate(centro, centro);
        ctx.rotate(angulo);

        // Anel de fundo, contínuo e fraco: dá o círculo sem competir com o arco.
        ctx.beginPath();
        ctx.arc(0, 0, raio, 0, Math.PI * 2);
        ctx.strokeStyle = cor(0.07 + intensidade * 0.05);
        ctx.lineWidth = anel.espessura * 0.7;
        ctx.stroke();

        // O arco vivo.
        ctx.beginPath();
        ctx.arc(0, 0, raio, 0, Math.PI * 2 * anel.preenchimento);
        ctx.strokeStyle = cor(0.3 + intensidade * 0.55);
        ctx.lineWidth = anel.espessura;
        ctx.lineCap = "round";
        ctx.stroke();

        for (let i = 0; i < anel.marcas; i += 1) {
          const a = (i / anel.marcas) * Math.PI * 2;
          const dentro = raio - 3;
          const fora = raio + (i % 4 === 0 ? 6 : 3);
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * dentro, Math.sin(a) * dentro);
          ctx.lineTo(Math.cos(a) * fora, Math.sin(a) * fora);
          ctx.strokeStyle = cor(i % 4 === 0 ? 0.28 : 0.12);
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        ctx.restore();
      }

      // Miolo: um disco que respira com a intensidade.
      const miolo = raioBase * (0.2 + intensidade * 0.1);
      const brilho = ctx.createRadialGradient(centro, centro, 0, centro, centro, miolo * 2.4);
      brilho.addColorStop(0, cor(0.55 + intensidade * 0.4));
      brilho.addColorStop(0.45, cor(0.14 + intensidade * 0.18));
      brilho.addColorStop(1, cor(0));

      ctx.beginPath();
      ctx.arc(centro, centro, miolo * 2.4, 0, Math.PI * 2);
      ctx.fillStyle = brilho;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(centro, centro, miolo, 0, Math.PI * 2);
      ctx.strokeStyle = cor(0.5 + intensidade * 0.4);
      ctx.lineWidth = 1.4;
      ctx.stroke();

      quadro += 1;
      animacao = requestAnimationFrame(desenhar);
    };

    let animacao = requestAnimationFrame(desenhar);
    return () => cancelAnimationFrame(animacao);
  }, [micLevelRef]);

  return (
    <div className={`nucleo estado-${coreState}`}>
      <canvas ref={canvasRef} aria-hidden="true" />
      <span className="nucleo-marca">JARVIS</span>
    </div>
  );
}
