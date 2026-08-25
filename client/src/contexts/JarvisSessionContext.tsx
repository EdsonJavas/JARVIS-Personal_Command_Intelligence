import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AcaoJarvis,
  EventoJarvis,
  MensagemDeFio,
  PedidoStream,
  PerguntaPendente,
} from "@shared/jarvisStream";
import { CAMINHO_EXECUCAO, CAMINHO_STREAM, JANELA_DE_HISTORICO } from "@shared/jarvisStream";
import { trpc } from "@/lib/trpc";
import { shouldSpeakChatReply } from "@/lib/chatResponsePolicy";
import { lerFluxoSse } from "@/lib/sseCliente";
import { criarFilaDeFala, type FilaDeFala } from "@/lib/filaDeFala";
import { criarFalaEmFluxo, type FalaEmFluxo } from "@/lib/falaEmFluxo";
import {
  PRIMEIRO_AVISO_MS,
  SEGUNDO_AVISO,
  SEGUNDO_AVISO_MS,
  proximoAviso,
} from "@shared/frasesDeEspera";
import { useJarvisVoice } from "@/hooks/useJarvisVoice";
import { useMicLevel } from "@/hooks/useMicLevel";
import { useIniciativas } from "@/hooks/useIniciativas";

const MAX_LATENCIAS = 40;

export type ConsoleError = {
  message: string;
  retryable: boolean;
  /** Quando o provedor pediu uma pausa: o botão conta o tempo e reenvia. */
  esperaMs?: number;
};

export type { AcaoJarvis };

/** Uma fala do histórico; as do Jarvis trazem as ações que ele executou. */
export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  acoes?: AcaoJarvis[];
};

/** Ação em andamento, mostrada enquanto roda. */
export type AcaoEmCurso = {
  acaoId: string;
  ferramenta: string;
  detalhe: string;
  iniciadaEm: number;
};

/** Estado visual do núcleo. Derivado de fatos, nunca decorativo. */
export type CoreState = "idle" | "listening" | "thinking" | "speaking";

type JarvisSession = {
  messages: ChatMessage[];
  send: (text: string) => void;
  cancelar: () => void;
  retryLast: () => void;
  clear: () => void;
  pending: boolean;
  error: ConsoleError | null;

  /** O que ele está dizendo que vai fazer, agora. */
  narracao: string | null;
  /**
   * A resposta sendo escrita, ainda provisória.
   *
   * O modelo escreve texto tanto antes de chamar ferramenta quanto na resposta
   * final, e só dá para saber qual é quando o fluxo termina. Então isto aparece
   * como rascunho e é SEMPRE substituído: pela resposta de verdade, ou
   * descartado quando o texto se revela narração de uma ação.
   */
  respostaParcial: string | null;
  acoesEmCurso: AcaoEmCurso[];
  /** Pergunta aguardando resposta. Enquanto existir, a execução está parada. */
  pergunta: PerguntaPendente | null;
  responder: (entrada: {
    opcaoId?: string;
    texto?: string;
    origem: "clique" | "voz" | "texto";
    cancelar?: boolean;
  }) => void;

  lastLatency: number | null;
  model: string | null;

  coreState: CoreState;
  micLevelRef: React.RefObject<number>;
  voice: ReturnType<typeof useJarvisVoice>;

  /** O que ele veio dizer por conta própria: lembretes, rotinas, vigias. */
  iniciativas: ReturnType<typeof useIniciativas>["iniciativas"];
  dispensarIniciativa: (compromissoId: number) => void;
};

const JarvisSessionContext = createContext<JarvisSession | null>(null);

export function useJarvisSession() {
  const session = useContext(JarvisSessionContext);
  if (!session) {
    throw new Error("useJarvisSession precisa estar dentro de <JarvisSessionProvider>");
  }
  return session;
}

function descreverErro(
  codigo: string,
  mensagem: string,
  recuperavel: boolean,
  esperaMs?: number
): ConsoleError {
  if (codigo === "quota_exceeded") {
    // Dois erros com o mesmo número e destinos opostos: o teto do minuto
    // renova em segundos; o do dia, só na virada. Dizer qual é decide se o
    // dono espera ou vai embora.
    if (esperaMs !== undefined) {
      return {
        message: "O provedor pediu uma pausa. Reenvio sozinho quando o limite por minuto renovar.",
        retryable: recuperavel,
        esperaMs,
      };
    }
    return {
      message: "Cota diária do provedor esgotada em todos os modelos. Renova na virada do dia.",
      retryable: recuperavel,
    };
  }
  if (codigo === "missing_key") {
    return {
      message: "Chave de IA ausente. Defina GEMINI_API_KEY no .env do servidor.",
      retryable: false,
    };
  }
  return { message: mensagem, retryable: recuperavel };
}

export function JarvisSessionProvider({ children }: { children: ReactNode }) {
  // A conversa vive só enquanto a aba está aberta.
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<ConsoleError | null>(null);
  const [latencias, setLatencias] = useState<number[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [narracao, setNarracao] = useState<string | null>(null);
  const [respostaParcial, setRespostaParcial] = useState<string | null>(null);
  const [acoesEmCurso, setAcoesEmCurso] = useState<AcaoEmCurso[]>([]);
  const [pergunta, setPergunta] = useState<PerguntaPendente | null>(null);

  const responderMutation = trpc.jarvis.responder.useMutation();
  const responderAsync = responderMutation.mutateAsync;

  const messagesRef = useRef(messages);
  const execucaoIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inicioRef = useRef(0);
  const filaRef = useRef<FilaDeFala | null>(null);

  /** A resposta falada frase a frase, conforme chega. */
  const fluxoRef = useRef<FalaEmFluxo>(criarFalaEmFluxo());
  /** Alguma frase desta execução já saiu pelo fluxo? Decide como o final entra. */
  const falouEmFluxoRef = useRef(false);

  /*
   * Avisos de espera.
   *
   * Silêncio depois da pergunta soa como não ter ouvido. Passado um instante
   * sem nenhum texto, ele diz que está pensando; passado bem mais, lembra que
   * ainda está nisso. Qualquer texto de verdade cancela os dois. Entram como
   * narração de propósito: a resposta, quando vier, corta o aviso no ar.
   */
  const avisosRef = useRef<number[]>([]);
  const contadorDeAvisosRef = useRef(0);

  const cancelarAvisos = useCallback(() => {
    for (const timer of avisosRef.current) window.clearTimeout(timer);
    avisosRef.current = [];
  }, []);

  const armarAvisos = useCallback(() => {
    cancelarAvisos();
    avisosRef.current = [
      window.setTimeout(() => {
        filaRef.current?.narrar(proximoAviso(contadorDeAvisosRef.current));
        contadorDeAvisosRef.current += 1;
      }, PRIMEIRO_AVISO_MS),
      window.setTimeout(() => filaRef.current?.narrar(SEGUNDO_AVISO), SEGUNDO_AVISO_MS),
    ];
  }, [cancelarAvisos]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const handleTranscriptRef = useRef<(texto: string) => void>(() => {});
  const voice = useJarvisVoice({
    onTranscript: (texto) => handleTranscriptRef.current(texto),
  });
  const micLevelRef = useMicLevel(voice.mode !== "off");

  const vozRef = useRef(voice);
  useEffect(() => {
    vozRef.current = voice;
  }, [voice]);

  /**
   * A fila é criada uma vez e lê a voz por ref. Recriá-la a cada render
   * zeraria a contagem de falas neurais a cada tecla digitada.
   */
  if (!filaRef.current) {
    filaRef.current = criarFilaDeFala({
      falarNeural: (texto, papel) =>
        vozRef.current.speak(texto, papel === "narracao" ? "anuncio" : "resposta"),
      prepararNeural: (texto, papel) =>
        vozRef.current.preparar(texto, papel === "narracao" ? "anuncio" : "resposta"),
      falarLocal: (texto) => vozRef.current.falarLocal(texto),
      pararFala: () => vozRef.current.stopSpeaking(),
      vozLocalEhNatural: () => vozRef.current.vozLocalEhNatural,
      vozDoServidor: () => vozRef.current.usarServidor,
      vozLigada: () =>
        shouldSpeakChatReply({
          enabled: vozRef.current.speechEnabled,
          canSpeak: typeof AudioContext !== "undefined" || vozRef.current.synthesisSupported,
          hasVoice: vozRef.current.hasVoice,
        }),
    });
  }

  /*
   * O Jarvis falando primeiro.
   *
   * Entra pela fila de fala como PERGUNTA, não como narração: uma iniciativa
   * chega fora de conversa, e como narração cairia no teto de falas por
   * execução ou seria descartada por uma resposta em curso — justamente o
   * lembrete que ele prometeu dar.
   */
  const { iniciativas, dispensar: dispensarIniciativa } = useIniciativas((iniciativa) => {
    filaRef.current?.perguntar(iniciativa.texto);
  });

  const encerrarExecucao = useCallback(() => {
    cancelarAvisos();
    setPending(false);
    setNarracao(null);
    setRespostaParcial(null);
    setAcoesEmCurso([]);
    setPergunta(null);
    execucaoIdRef.current = null;

    // Abortar, não apenas soltar a referência. Sem o abort, o `fetch` seguia
    // preso lendo um corpo que nunca acabava: a conexão ficava viva depois da
    // resposta e o navegador travava na sétima mensagem, no teto de seis
    // conexões por host. O servidor agora fecha no evento terminal; isto aqui é
    // o outro lado da mesma trava, e cobre o caso de o servidor sumir.
    abortRef.current?.abort();
    abortRef.current = null;
  }, [cancelarAvisos]);

  const aplicarEvento = useCallback(
    (evento: EventoJarvis) => {
      switch (evento.tipo) {
        case "inicio":
          execucaoIdRef.current = evento.execucaoId;
          setModel(evento.modelo);
          break;

        case "pensando":
          setNarracao(null);
          setRespostaParcial(null);
          fluxoRef.current.novaRodada();
          // Cada rodada recomeça em silêncio; o aviso vale para todas.
          armarAvisos();
          break;

        case "resposta_parcial":
          cancelarAvisos();
          setRespostaParcial((atual) => (atual ?? "") + evento.texto);
          // Frase fechada já vai para a voz, sem esperar o final.
          for (const frase of fluxoRef.current.receber(evento.texto)) {
            falouEmFluxoRef.current = true;
            filaRef.current?.trecho(frase);
          }
          break;

        case "narracao":
          cancelarAvisos();
          // O texto era narração, não resposta: o rascunho perde a validade.
          setRespostaParcial(null);
          setNarracao(evento.texto);
          // Só o que o fluxo ainda não disse: sem isto, cada frase narrada
          // que já tinha saído em fluxo era dita duas vezes.
          for (const frase of fluxoRef.current.concluir(evento.texto)) {
            filaRef.current?.narrar(frase);
          }
          break;

        case "acao_inicio":
          setRespostaParcial(null);
          setAcoesEmCurso((atual) => [
            ...atual,
            {
              acaoId: evento.acaoId,
              ferramenta: evento.ferramenta,
              detalhe: evento.detalhe,
              iniciadaEm: Date.now(),
            },
          ]);
          break;

        case "acao_fim":
          setAcoesEmCurso((atual) => atual.filter((acao) => acao.acaoId !== evento.acaoId));
          break;

        case "pergunta":
          setPergunta(evento.pergunta);
          // Pergunta fala sempre e fora da cota de narração: a execução fica
          // parada esperando, e o dono precisa ouvir o que travou.
          filaRef.current?.perguntar(evento.pergunta.pergunta);
          break;

        case "pergunta_resolvida":
          setPergunta((atual) => (atual?.id === evento.perguntaId ? null : atual));
          break;

        case "resposta": {
          setLatencias((atual) =>
            [...atual, Math.round(performance.now() - inicioRef.current)].slice(-MAX_LATENCIAS)
          );
          // A resposta de verdade chegou: o rascunho sai de cena.
          setRespostaParcial(null);
          setMessages((atual) => [
            ...atual,
            { role: "assistant", content: evento.texto, acoes: evento.acoes },
          ]);
          {
            const faltam = fluxoRef.current.concluir(evento.fala || evento.texto);
            for (const frase of faltam) {
              // Com frases já no ar, o final entra na fila atrás delas. Sem
              // nenhuma, é a resposta inteira, e ela corta a narração como antes.
              if (falouEmFluxoRef.current) filaRef.current?.trecho(frase);
              else filaRef.current?.responder(frase);
            }
          }
          encerrarExecucao();
          break;
        }

        case "erro":
          setError(descreverErro(evento.codigo, evento.mensagem, evento.recuperavel, evento.esperaMs));
          encerrarExecucao();
          break;

        case "cancelado":
          encerrarExecucao();
          break;
      }
    },
    [encerrarExecucao]
  );

  const abrirFluxo = useCallback(
    async (pedido: PedidoStream) => {
      const controle = new AbortController();
      abortRef.current = controle;

      try {
        const resposta = await fetch(CAMINHO_STREAM, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(pedido),
          credentials: "include",
          signal: controle.signal,
        });

        if (!resposta.ok || !resposta.body) {
          const corpo = await resposta.json().catch(() => null);
          setError({
            message: corpo?.mensagem ?? `O servidor recusou a execução (${resposta.status}).`,
            retryable: resposta.status >= 500,
          });
          encerrarExecucao();
          return;
        }

        await lerFluxoSse(resposta.body, aplicarEvento, controle.signal);
      } catch (erro) {
        if (controle.signal.aborted) return;
        setError({ message: "A conexão com o servidor caiu.", retryable: true });
      } finally {
        if (abortRef.current === controle) encerrarExecucao();
      }
    },
    [aplicarEvento, encerrarExecucao]
  );

  const perguntaRef = useRef<PerguntaPendente | null>(null);
  useEffect(() => {
    perguntaRef.current = pergunta;
  }, [pergunta]);

  const responder = useCallback(
    (entrada: {
      opcaoId?: string;
      texto?: string;
      origem: "clique" | "voz" | "texto";
      cancelar?: boolean;
    }) => {
      const atual = perguntaRef.current;
      if (!atual) return;
      void responderAsync({ perguntaId: atual.id, ...entrada }).catch(() => {});
    },
    [responderAsync]
  );

  const send = useCallback(
    (texto: string) => {
      const conteudo = texto.trim();
      if (!conteudo) return;

      // Com pergunta aberta, o que o dono escreve ou fala é RESPOSTA, não ordem
      // nova. Sem esta ramificação, responder por voz mataria a própria tarefa
      // que fez a pergunta.
      if (perguntaRef.current) {
        setMessages((atual) => [...atual, { role: "user", content: conteudo }]);
        responder({ texto: conteudo, origem: "texto" });
        return;
      }

      // Mensagem nova durante execução cancela a anterior em vez de ser
      // descartada: descartar fazia a ordem do dono sumir sem aviso.
      if (execucaoIdRef.current) {
        const id = execucaoIdRef.current;
        void fetch(`${CAMINHO_EXECUCAO}/${id}/cancelar`, {
          method: "POST",
          credentials: "include",
        }).catch(() => {});
        abortRef.current?.abort();
      }

      setError(null);
      filaRef.current?.encerrar();
      filaRef.current = criarFilaDeFala({
        falarNeural: (t, papel) =>
          vozRef.current.speak(t, papel === "narracao" ? "anuncio" : "resposta"),
        prepararNeural: (t, papel) =>
          vozRef.current.preparar(t, papel === "narracao" ? "anuncio" : "resposta"),
        falarLocal: (t) => vozRef.current.falarLocal(t),
        pararFala: () => vozRef.current.stopSpeaking(),
        vozLocalEhNatural: () => vozRef.current.vozLocalEhNatural,
        vozDoServidor: () => vozRef.current.usarServidor,
        vozLigada: () =>
          shouldSpeakChatReply({
            enabled: vozRef.current.speechEnabled,
            canSpeak: typeof AudioContext !== "undefined" || vozRef.current.synthesisSupported,
            hasVoice: vozRef.current.hasVoice,
          }),
      });

      const historico: MensagemDeFio[] = [
        ...messagesRef.current,
        { role: "user" as const, content: conteudo },
      ].slice(-JANELA_DE_HISTORICO);

      setMessages((atual) => [...atual, { role: "user", content: conteudo }]);
      setPending(true);
      setNarracao(null);
      setAcoesEmCurso([]);
      inicioRef.current = performance.now();
      fluxoRef.current = criarFalaEmFluxo();
      falouEmFluxoRef.current = false;
      armarAvisos();

      void abrirFluxo({ modo: "novo", mensagens: historico });
    },
    [abrirFluxo, responder, armarAvisos]
  );

  useEffect(() => {
    // Pela voz, a origem precisa ser "voz": em confirmação isso impede que a
    // transcrição da própria fala do Jarvis autorize a ação.
    handleTranscriptRef.current = (texto: string) => {
      if (perguntaRef.current) {
        setMessages((atual) => [...atual, { role: "user", content: texto }]);
        responder({ texto, origem: "voz" });
        return;
      }
      send(texto);
    };
  }, [send, responder]);

  const cancelar = useCallback(() => {
    const id = execucaoIdRef.current;
    if (!id) return;
    void fetch(`${CAMINHO_EXECUCAO}/${id}/cancelar`, {
      method: "POST",
      credentials: "include",
    }).catch(() => {});
    abortRef.current?.abort();
    filaRef.current?.encerrar();
    encerrarExecucao();
  }, [encerrarExecucao, armarAvisos, cancelarAvisos]);

  const retryLast = useCallback(() => {
    const ultima = [...messagesRef.current].reverse().find((item) => item.role === "user");
    if (ultima) send(ultima.content);
  }, [send]);

  const clear = useCallback(() => {
    vozRef.current.stopSpeaking();
    setMessages([]);
    setError(null);
  }, []);

  // Fechar a aba no meio de uma execução deixaria o laço rodando até a carência
  // de órfã expirar. O sendBeacon é o único envio que sobrevive ao unload.
  useEffect(() => {
    const aoSair = () => {
      const id = execucaoIdRef.current;
      if (id) navigator.sendBeacon?.(`${CAMINHO_EXECUCAO}/${id}/cancelar`);
    };
    window.addEventListener("beforeunload", aoSair);
    return () => window.removeEventListener("beforeunload", aoSair);
  }, []);

  const coreState: CoreState = pending
    ? "thinking"
    : voice.speaking
      ? "speaking"
      : voice.mode !== "off"
        ? "listening"
        : "idle";

  const value = useMemo<JarvisSession>(
    () => ({
      messages,
      send,
      cancelar,
      retryLast,
      clear,
      pending,
      error,
      narracao,
      respostaParcial,
      acoesEmCurso,
      pergunta,
      responder,
      lastLatency: latencias.length > 0 ? latencias[latencias.length - 1] : null,
      model,
      coreState,
      micLevelRef,
      voice,
      iniciativas,
      dispensarIniciativa,
    }),
    [
      messages,
      send,
      cancelar,
      retryLast,
      clear,
      pending,
      error,
      narracao,
      respostaParcial,
      acoesEmCurso,
      pergunta,
      responder,
      latencias,
      model,
      coreState,
      micLevelRef,
      voice,
      iniciativas,
      dispensarIniciativa,
    ]
  );

  return (
    <JarvisSessionContext.Provider value={value}>{children}</JarvisSessionContext.Provider>
  );
}
