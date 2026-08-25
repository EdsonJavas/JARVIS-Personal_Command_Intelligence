import { useEffect, useRef } from "react";

/**
 * Mede a intensidade real do microfone e devolve o valor por ref.
 *
 * O nível é escrito numa ref em vez de estado do React de propósito: ele muda a
 * cada quadro, e um setState a 60fps derrubaria a interface inteira. Quem
 * desenha (o canvas do núcleo) lê a ref dentro do próprio loop de animação.
 */
export function useMicLevel(active: boolean) {
  const levelRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;

    let cancelled = false;

    const stop = () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      contextRef.current?.close().catch(() => {});
      contextRef.current = null;
      levelRef.current = 0;
    };

    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((stream) => {
        // O usuário pode ter desligado a escuta enquanto a permissão era pedida.
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        const context = new AudioContext();
        contextRef.current = context;

        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.75;
        source.connect(analyser);

        const samples = new Uint8Array(analyser.frequencyBinCount);

        const measure = () => {
          analyser.getByteTimeDomainData(samples);

          // RMS em torno do silêncio (128) — reflete volume percebido melhor
          // que o pico, que salta com qualquer estalo.
          let sum = 0;
          for (let i = 0; i < samples.length; i += 1) {
            const deviation = (samples[i] - 128) / 128;
            sum += deviation * deviation;
          }
          const rms = Math.sqrt(sum / samples.length);

          // Curva de resposta: fala normal fica na faixa alta sem estourar.
          const normalized = Math.min(1, rms * 3.6);
          // Sobe rápido, desce devagar — evita tremor e dá peso ao movimento.
          const previous = levelRef.current;
          levelRef.current = normalized > previous
            ? previous + (normalized - previous) * 0.45
            : previous + (normalized - previous) * 0.12;

          frameRef.current = requestAnimationFrame(measure);
        };

        measure();
      })
      .catch(() => {
        // Permissão negada ou dispositivo ausente: o núcleo segue no estado de
        // repouso, sem quebrar o restante da interface.
        levelRef.current = 0;
      });

    return () => {
      cancelled = true;
      stop();
    };
  }, [active]);

  return levelRef;
}
