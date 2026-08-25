import { useEffect, useRef, useState } from "react";
import { useJarvisSession } from "@/contexts/JarvisSessionContext";

/**
 * O campo de voz, no canto superior direito.
 *
 * Não é enfeite nem animação de espera: é o sinal do áudio que está tocando,
 * medido por um AnalyserNode ligado à saída. Quando ele fala, a linha é a fala.
 * Quando cala, a linha assenta — e essa quietude é informação também.
 *
 * São três leituras do mesmo sinal, porque cada uma responde a uma pergunta
 * diferente: o TRAÇADO mostra a forma da fala, as BARRAS mostram o histórico
 * recente (dá para ver a frase inteira, não só o instante), e o NÍVEL em dB dá
 * o número. Enquanto ele escuta, o mesmo campo mostra o microfone — o mesmo
 * canto contando os dois lados, em vez de dois cantos quase sempre vazios.
 */

/** Barras de histórico: cobre uns três segundos de fala a 60 quadros. */
const HISTORICO = 56;

const AZUL = "120, 200, 255";

export function OndaDeVoz() {
  const { coreState, voice, micLevelRef } = useJarvisSession();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const estadoRef = useRef(coreState);
  const vozRef = useRef(voice);

  /** Só o número precisa de render do React; o desenho vive no canvas. */
  const [nivel, setNivel] = useState(0);
  const [pico, setPico] = useState(0);

  useEffect(() => {
    estadoRef.current = coreState;
  }, [coreState]);
  useEffect(() => {
    vozRef.current = voice;
  }, [voice]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const historico = new Float32Array(HISTORICO);
    let animacao = 0;
    let quadro = 0;
    let picoRecente = 0;
    /** Decai devagar: um pico que some no quadro seguinte não é legível. */
    let picoVisivel = 0;

    const desenhar = () => {
      const largura = canvas.clientWidth;
      const altura = canvas.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);

      if (canvas.width !== largura * dpr || canvas.height !== altura * dpr) {
        canvas.width = largura * dpr;
        canvas.height = altura * dpr;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, largura, altura);

      const estado = estadoRef.current;
      /* A faixa de cima é o traçado; a de baixo, o histórico. */
      const alturaTracado = altura * 0.56;
      const meio = alturaTracado / 2;
      const topoBarras = alturaTracado + 3;
      const alturaBarras = altura - topoBarras;

      // Escala: três marcas discretas dão referência de amplitude sem poluir.
      for (const fracao of [0.25, 0.5, 0.75]) {
        const y = alturaTracado * fracao;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(largura, y);
        ctx.strokeStyle = `rgba(${AZUL}, ${fracao === 0.5 ? 0.14 : 0.05})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      const onda = vozRef.current.speechWaveRef.current;
      const falando = estado === "speaking";

      let intensidade: number;

      if (falando) {
        // O traçado real, ponto a ponto.
        const passo = largura / (onda.length - 1);
        let maior = 0;

        ctx.beginPath();
        for (let i = 0; i < onda.length; i += 1) {
          const desvio = (onda[i] - 128) / 128;
          maior = Math.max(maior, Math.abs(desvio));
          const y = meio - desvio * meio * 0.92;
          if (i === 0) ctx.moveTo(0, y);
          else ctx.lineTo(i * passo, y);
        }
        ctx.strokeStyle = `rgba(150, 215, 255, 0.95)`;
        ctx.lineWidth = 1.2;
        ctx.lineJoin = "round";
        ctx.stroke();

        // Reflexo abaixo do eixo: dá corpo sem virar borrão.
        ctx.beginPath();
        for (let i = 0; i < onda.length; i += 1) {
          const desvio = (onda[i] - 128) / 128;
          const y = meio + desvio * meio * 0.42;
          if (i === 0) ctx.moveTo(0, y);
          else ctx.lineTo(i * passo, y);
        }
        ctx.strokeStyle = `rgba(${AZUL}, 0.2)`;
        ctx.lineWidth = 0.8;
        ctx.stroke();

        intensidade = vozRef.current.speechPulseRef.current;
        picoRecente = Math.max(picoRecente, maior);
      } else {
        intensidade =
          estado === "listening"
            ? micLevelRef.current
            : estado === "thinking"
              ? 0.08 + Math.abs(Math.sin(quadro * 0.035)) * 0.12
              : 0.012;

        // Linha viva mesmo em repouso: uma reta perfeita parece tela congelada.
        ctx.beginPath();
        for (let x = 0; x <= largura; x += 3) {
          const ruido = Math.sin(x * 0.09 + quadro * 0.05) * intensidade * meio * 0.55;
          const y = meio + ruido;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${AZUL}, ${0.25 + intensidade * 0.5})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Histórico rolando, embaixo.
      historico.copyWithin(0, 1);
      historico[HISTORICO - 1] = intensidade;

      const larguraBarra = largura / HISTORICO;
      for (let i = 0; i < HISTORICO; i += 1) {
        const h = Math.max(1, historico[i] * alturaBarras);
        // As mais recentes, à direita, aparecem mais: é onde o olho está.
        const alfa = 0.1 + (i / HISTORICO) * 0.55;
        ctx.fillStyle = `rgba(${AZUL}, ${alfa})`;
        ctx.fillRect(i * larguraBarra, topoBarras + (alturaBarras - h), Math.max(1, larguraBarra - 1), h);
      }

      picoVisivel = Math.max(picoVisivel * 0.985, intensidade);

      // O número muda poucas vezes por segundo: atualizar a cada quadro
      // reconstruiria a árvore do React sessenta vezes por segundo à toa.
      if (quadro % 6 === 0) {
        setNivel(intensidade);
        setPico(picoVisivel);
        picoRecente = 0;
      }

      quadro += 1;
      animacao = requestAnimationFrame(desenhar);
    };

    animacao = requestAnimationFrame(desenhar);
    return () => cancelAnimationFrame(animacao);
  }, [micLevelRef]);

  /** Silêncio absoluto viraria -Infinity dB; o piso evita isso. */
  const db = nivel > 0.001 ? Math.max(-60, 20 * Math.log10(nivel)) : -60;

  const rotulo =
    coreState === "speaking"
      ? "SAÍDA"
      : coreState === "listening"
        ? "ENTRADA"
        : coreState === "thinking"
          ? "PROCESSANDO"
          : "REPOUSO";

  return (
    <div className={`campo-voz estado-${coreState}`}>
      <div className="campo-voz-topo">
        <span>{rotulo}</span>
        <b>{db <= -59 ? "—" : `${db.toFixed(0)} dB`}</b>
      </div>

      <canvas ref={canvasRef} aria-hidden="true" />

      <div className="campo-voz-base">
        <span>{voice.usarServidor ? "NEURAL" : "SISTEMA"}</span>
        <i className="campo-voz-pico">
          <em style={{ width: `${Math.min(100, pico * 100)}%` }} />
        </i>
        <span>24k</span>
      </div>
    </div>
  );
}
