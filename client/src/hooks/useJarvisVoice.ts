import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  avisoDeVozAntiga,
  escolherVozBrasileira,
  getBrazilianVoiceFallback,
} from "@/lib/voiceProfile";
import { lerVozEscolhida, qualidadeDaVoz } from "@/lib/vozEscolhida";
import { hasWakeWord, requestAfterWakeWord } from "@/lib/voiceWakeWord";

/**
 * A API de reconhecimento de fala não faz parte do lib.dom padrão do TypeScript,
 * então declaramos apenas a superfície que este hook usa.
 */
type SpeechRecognitionAlternative = { transcript: string };
type SpeechRecognitionResult = {
  isFinal: boolean;
  0: SpeechRecognitionAlternative;
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResult };
};
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type VoiceMode = "off" | "dictation" | "wake";

type UseJarvisVoiceOptions = {
  /** Chamado com o texto reconhecido, pronto para virar mensagem. */
  onTranscript: (text: string) => void;
};

export function useJarvisVoice({ onTranscript }: UseJarvisVoiceOptions) {
  const [mode, setMode] = useState<VoiceMode>("off");
  const [interim, setInterim] = useState("");
  const [speechEnabled, setSpeechEnabled] = useState(true);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [usingFallbackVoice, setUsingFallbackVoice] = useState(false);

  /**
   * Amplitude instantânea da fala do Jarvis, de 0 a 1. Com a voz neural este
   * valor vem do próprio áudio, medido por um AnalyserNode — o cérebro pulsa
   * com a forma de onda real. Só na voz de reserva do sistema ele é aproximado
   * pelos eventos de palavra, porque a síntese do navegador não expõe o sinal.
   */
  const speechPulseRef = useRef(0);

  /**
   * O traçado da onda, não só a intensidade.
   *
   * O pulso sozinho serve para um brilho pulsar; para DESENHAR a voz é preciso a
   * forma completa. Guardado em ref e preenchido no lugar, porque isto é lido a
   * sessenta quadros por segundo e um `useState` reconstruiria a árvore inteira
   * a cada quadro.
   */
  const speechWaveRef = useRef<Uint8Array>(new Uint8Array(128).fill(128));

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const modeRef = useRef<VoiceMode>("off");
  const onTranscriptRef = useRef(onTranscript);

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const analyserFrameRef = useRef<number | null>(null);

  /**
   * Contador de geração da fala.
   *
   * Entre pedir a síntese e ter o áudio decodificado passam alguns segundos.
   * Sem este contador, uma narração cancelada nesse intervalo volta e toca POR
   * CIMA da resposta final — o áudio já estava a caminho quando o cancelamento
   * chegou.
   */
  const geracaoRef = useRef(0);

  const speakMutation = trpc.jarvis.speak.useMutation();
  const speakMutateAsync = speakMutation.mutateAsync;

  /** Por ref: `speak` é memoizado e não deve mudar a cada troca de voz. */
  const vozDoServidorRef = useRef<string | null>(null);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const recognitionSupported = useMemo(() => getRecognitionConstructor() !== null, []);
  const synthesisSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    if (!synthesisSupported) return;
    const load = () => setVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, [synthesisSupported]);

  /**
   * A escolha do dono manda, sempre.
   *
   * A automática errou três vezes seguidas — a máquina dele só tinha a "Maria
   * Desktop" e qualquer regra que exigisse português acabava nela. Quando ele
   * apontou uma voz de ouvido, não há heurística que deva discordar.
   */
  const [vozPreferida, setVozPreferida] = useState<string | null>(() => lerVozEscolhida());

  /*
   * A voz do SERVIDOR ganha de qualquer voz do navegador quando existe.
   *
   * Ela é neural, roda na máquina, não tem cota e soa igual em Chrome, Edge ou
   * Firefox. As vozes que este Windows tem instaladas são da geração mais antiga
   * — foi delas que veio a reclamação de timbre robótico.
   */
  const { data: doServidor } = trpc.jarvis.vozes.useQuery(undefined, {
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const vozDoServidor = vozPreferida?.startsWith("servidor:")
    ? vozPreferida.slice("servidor:".length)
    : null;

  // Sem escolha explícita, a local ainda ganha: é o melhor padrão disponível.
  const usarServidor = Boolean(vozDoServidor) || (!vozPreferida && Boolean(doServidor?.localDisponivel));

  const vozEscolhida = useMemo(() => {
    const apontada = vozPreferida
      ? voices.find((voz) => voz.name === vozPreferida)
      : undefined;
    if (apontada) return { voz: apontada, natural: qualidadeDaVoz(apontada) === "neural" };
    // Voz escolhida que sumiu da lista — outro navegador, outra máquina — cai na
    // automática em vez de emudecer.
    return escolherVozBrasileira(voices);
  }, [voices, vozPreferida]);

  const localVoice = vozEscolhida?.voz;
  const vozLocalEhNatural = vozEscolhida?.natural ?? false;

  useEffect(() => {
    vozDoServidorRef.current = vozDoServidor;
  }, [vozDoServidor]);

  const localVoiceWarning = useMemo(() => {
    if (voices.length === 0) return null;
    if (!localVoice) return getBrazilianVoiceFallback(voices);
    return avisoDeVozAntiga(vozEscolhida);
  }, [voices, localVoice, vozEscolhida]);

  /* ------------------------------- escuta -------------------------------- */

  const stopListening = useCallback(() => {
    modeRef.current = "off";
    setMode("off");
    setInterim("");
    recognitionRef.current?.abort();
    recognitionRef.current = null;
  }, []);

  const startListening = useCallback(
    (nextMode: Exclude<VoiceMode, "off">) => {
      const Recognition = getRecognitionConstructor();
      if (!Recognition) {
        setError("Este navegador não oferece reconhecimento de voz. Use o Chrome ou o Edge.");
        return;
      }

      recognitionRef.current?.abort();
      setError(null);

      const recognition = new Recognition();
      recognition.lang = "pt-BR";
      recognition.interimResults = true;
      recognition.continuous = nextMode === "wake";

      recognition.onresult = (event) => {
        let finalText = "";
        let pendingText = "";

        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const text = result[0].transcript;
          if (result.isFinal) finalText += text;
          else pendingText += text;
        }

        setInterim(pendingText);
        const spoken = finalText.trim();
        if (!spoken) return;

        if (modeRef.current === "wake") {
          if (!hasWakeWord(spoken)) return;
          const request = requestAfterWakeWord(spoken);
          if (!request) return;
          setInterim("");
          onTranscriptRef.current(request);
          return;
        }

        setInterim("");
        onTranscriptRef.current(spoken);
      };

      recognition.onerror = (event) => {
        if (event.error === "no-speech" || event.error === "aborted") return;
        setError(
          event.error === "not-allowed"
            ? "Permissão de microfone negada. Libere o acesso nas configurações do navegador."
            : `Falha no reconhecimento de voz (${event.error}).`
        );
        stopListening();
      };

      recognition.onend = () => {
        if (modeRef.current === "wake" && recognitionRef.current === recognition) {
          try {
            recognition.start();
            return;
          } catch {
            /* já reiniciado pelo navegador */
          }
        }
        if (modeRef.current === "dictation") {
          setMode("off");
          modeRef.current = "off";
        }
        setInterim("");
      };

      recognitionRef.current = recognition;
      modeRef.current = nextMode;
      setMode(nextMode);
      recognition.start();
    },
    [stopListening]
  );

  const toggleMode = useCallback(
    (target: Exclude<VoiceMode, "off">) => {
      if (modeRef.current === target) stopListening();
      else startListening(target);
    },
    [startListening, stopListening]
  );

  /* -------------------------------- fala --------------------------------- */

  /**
   * Quem está esperando a fala atual terminar.
   *
   * `speak` só resolvia quando o áudio COMEÇAVA, então quem chamava não tinha
   * como saber que a frase acabou — e a fala seguinte entrava por cima. Este
   * resolvedor é o que transforma a promessa de `speak` em "acabou de falar".
   */
  const fimDaFalaRef = useRef<(() => void) | null>(null);

  /** Libera quem espera. Chamado tanto no fim natural quanto no corte. */
  const resolverFim = useCallback(() => {
    const resolver = fimDaFalaRef.current;
    fimDaFalaRef.current = null;
    resolver?.();
  }, []);

  const stopAudio = useCallback(() => {
    geracaoRef.current += 1;
    if (analyserFrameRef.current !== null) {
      cancelAnimationFrame(analyserFrameRef.current);
      analyserFrameRef.current = null;
    }
    try {
      sourceRef.current?.stop();
    } catch {
      /* já parado */
    }
    sourceRef.current = null;
    speechPulseRef.current = 0;
    // Sem isto a onda congela no último quadro, como se ele tivesse parado no
    // meio de uma palavra.
    speechWaveRef.current.fill(128);
    setPlaying(false);
    // Cortar a fala não pode deixar a fila travada esperando um fim que não vem.
    resolverFim();
  }, [resolverFim]);

  /**
   * Voz de reserva: síntese do navegador, quando a neural não está disponível.
   *
   * Devolve promessa que resolve no fim da locução, pelo mesmo motivo da neural:
   * quem enfileira precisa saber quando pode falar a próxima frase.
   */
  const speakWithSystemVoice = useCallback(
    (text: string): Promise<void> => {
      if (!synthesisSupported || !localVoice) return Promise.resolve();

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = localVoice;
      utterance.lang = localVoice.lang;

      /*
       * Voz neural não quer correção: ela já tem prosódia própria, e deslocar o
       * tom introduz exatamente o artefato metálico que se quer evitar. A SAPI
       * antiga, ao contrário, melhora um pouco com tom mais grave e ritmo
       * levemente mais lento — não vira natural, mas fica menos estridente.
       */
      utterance.rate = vozLocalEhNatural ? 1 : 0.98;
      utterance.pitch = vozLocalEhNatural ? 1 : 0.92;

      utterance.onstart = () => {
        setPlaying(true);
        setUsingFallbackVoice(true);
      };
      // Sem acesso ao sinal: cada palavra pronunciada empurra o pulso.
      utterance.onboundary = () => {
        speechPulseRef.current = Math.min(1, speechPulseRef.current + 0.55);
      };

      return new Promise<void>((resolver) => {
        // `cancel()` dispara fim OU erro conforme o navegador; resolver uma vez
        // só evita depender de qual dos dois veio.
        let resolvido = false;
        const terminar = () => {
          if (resolvido) return;
          resolvido = true;
          setPlaying(false);
          speechPulseRef.current = 0;
          resolver();
        };

        utterance.onend = terminar;
        utterance.onerror = terminar;
        window.speechSynthesis.speak(utterance);
      });
    },
    [localVoice, synthesisSupported]
  );

  const speak = useCallback(
    async (text: string, prioridade: "resposta" | "anuncio" = "resposta") => {
      stopAudio();
      if (synthesisSupported) window.speechSynthesis.cancel();

      const geracao = geracaoRef.current;
      setSynthesizing(true);
      /* Resolve quando o áudio ACABA. Só existe se a reprodução chegou a começar. */
      let esperarFim: Promise<void> | null = null;

      try {
        const result = await speakMutateAsync({
          text,
          prioridade,
          voz: vozDoServidorRef.current ?? undefined,
        });
        if (geracaoRef.current !== geracao) return;

        const context = audioContextRef.current ?? new AudioContext();
        audioContextRef.current = context;
        if (context.state === "suspended") await context.resume();

        const bytes = Uint8Array.from(atob(result.audio), (char) => char.charCodeAt(0));
        const buffer = await context.decodeAudioData(bytes.buffer);
        if (geracaoRef.current !== geracao) return;

        const source = context.createBufferSource();
        source.buffer = buffer;

        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.7;

        source.connect(analyser);
        analyser.connect(context.destination);

        const samples = new Uint8Array(analyser.frequencyBinCount);
        const measure = () => {
          analyser.getByteTimeDomainData(samples);

          let sum = 0;
          for (let i = 0; i < samples.length; i += 1) {
            const deviation = (samples[i] - 128) / 128;
            sum += deviation * deviation;
          }
          speechPulseRef.current = Math.min(1, Math.sqrt(sum / samples.length) * 3.4);

          // Reamostra para o tamanho fixo do traçado: o analisador entrega
          // centenas de pontos e o desenho usa 128, então a conta é feita uma
          // vez aqui em vez de a cada quadro do desenho.
          const onda = speechWaveRef.current;
          const passo = samples.length / onda.length;
          for (let i = 0; i < onda.length; i += 1) onda[i] = samples[Math.floor(i * passo)];

          analyserFrameRef.current = requestAnimationFrame(measure);
        };

        source.onended = () => {
          if (sourceRef.current === source) stopAudio();
        };

        sourceRef.current = source;
        setUsingFallbackVoice(false);
        setPlaying(true);

        // A espera é armada ANTES do start: áudio curto pode terminar antes da
        // próxima linha rodar, e aí o resolvedor chegaria tarde demais — a fila
        // ficaria parada esperando um fim que já passou.
        esperarFim = new Promise<void>((resolver) => {
          fimDaFalaRef.current = resolver;
        });

        source.start();
        measure();
      } catch {
        // Cota, rede ou modelo indisponível: a resposta não fica muda se houver
        // uma voz do sistema instalada.
        setSynthesizing(false);
        return speakWithSystemVoice(text);
      } finally {
        setSynthesizing(false);
      }

      // Só agora a promessa de `speak` significa "terminei de falar".
      if (esperarFim) await esperarFim;
    },
    [speakMutateAsync, speakWithSystemVoice, stopAudio, synthesisSupported]
  );

  const stopSpeaking = useCallback(() => {
    stopAudio();
    if (synthesisSupported) window.speechSynthesis.cancel();
    setSynthesizing(false);
  }, [stopAudio, synthesisSupported]);

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
      if (analyserFrameRef.current !== null) cancelAnimationFrame(analyserFrameRef.current);
      try {
        sourceRef.current?.stop();
      } catch {
        /* já parado */
      }
      audioContextRef.current?.close().catch(() => {});
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    },
    []
  );

  return {
    mode,
    interim,
    error,
    speaking: playing || synthesizing,
    synthesizing,
    usingFallbackVoice,
    /** Traçado da voz, 128 pontos, 128 = silêncio. Lido a cada quadro. */
    speechWaveRef,
    vozLocalEhNatural,
    /** Falar pelo servidor: neural, local, sem cota e igual em todo navegador. */
    usarServidor,
    /** Relido quando o dono fecha o seletor, para a nova voz valer na hora. */
    recarregarVozPreferida: () => setVozPreferida(lerVozEscolhida()),
    speechPulseRef,
    recognitionSupported,
    synthesisSupported,
    /** A voz neural vem do servidor, então existe voz mesmo sem voz local. */
    hasVoice: true,
    // O aviso vale mesmo antes de cair para a voz local: é ele que conta ao
    // dono que existe voz melhor disponível.
    voiceWarning: localVoiceWarning,
    speechEnabled,
    setSpeechEnabled,
    toggleMode,
    stopListening,
    speak,
    /** Voz do sistema, usada quando a neural falha ou a cota estoura. */
    falarLocal: speakWithSystemVoice,
    stopSpeaking,
  };
}
