import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Loader2,
  RotateCcw,
  Send,
  ShieldAlert,
  Square,
  Terminal,
} from "lucide-react";
import { shouldSubmitComposer } from "@/lib/chatComposer";
import { useJarvisSession, type ConsoleError } from "@/contexts/JarvisSessionContext";

export function JarvisConsole() {
  const {
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
    voice,
  } = useJarvisSession();

  const [draft, setDraft] = useState("");

  /*
   * Contagem regressiva quando o provedor pediu uma pausa.
   *
   * Reenvia sozinho ao chegar em zero — UMA vez por erro. Se a nova tentativa
   * falhar de novo, o botão volta a ser manual: reenviar automaticamente em
   * laço a cada quinze segundos seria bater no provedor enquanto ele pede para
   * parar.
   */
  const [restam, setRestam] = useState(0);
  const erroJaReenviado = useRef<ConsoleError | null>(null);
  useEffect(() => {
    if (!error?.esperaMs || erroJaReenviado.current === error) {
      setRestam(0);
      return;
    }
    const fim = Date.now() + error.esperaMs;
    const tick = () => setRestam(Math.max(0, Math.ceil((fim - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(() => {
      tick();
      if (Date.now() >= fim) {
        window.clearInterval(timer);
        erroJaReenviado.current = error;
        retryLast();
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [error, retryLast]);
  const threadRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    composerRef.current?.focus();
  }, []);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
  }, [messages, pending, narracao, respostaParcial, acoesEmCurso.length, pergunta]);

  const submit = () => {
    if (!draft.trim()) return;
    send(draft);
    setDraft("");
  };

  return (
    <section className="console-painel" aria-label="Canal de texto">
      <header className="painel-topo">
        <span>CANAL DE TEXTO</span>
        <div className="head-actions">
          {pending ? (
            <button type="button" onClick={cancelar} title="Interromper a execução">
              <Square size={11} />
            </button>
          ) : null}
          {messages.length > 0 ? (
            <button type="button" onClick={clear} title="Limpar a conversa">
              <RotateCcw size={12} />
            </button>
          ) : null}
        </div>
      </header>

      <div className="console-thread" ref={threadRef}>
        {messages.length === 0 && !pending ? (
          <div className="console-empty">
            <p>Canal aberto.</p>
            <span>
              Escreva abaixo, ou fale — o núcleo continua ouvindo. Ele conta o que está
              fazendo enquanto faz.
            </span>
          </div>
        ) : null}

        {messages.map((message, index) => (
          <article key={`${message.role}-${index}`} className={`console-turn ${message.role}`}>
            <small>{message.role === "user" ? "VOCÊ" : "JARVIS"}</small>

            {/* Transparência: o que rodou na máquina fica à vista, acima da
                resposta que aquilo produziu. */}
            {message.acoes?.length ? (
              <ul className="turn-actions">
                {message.acoes.map((acao, posicao) => (
                  <li key={posicao} className={acao.ok ? "" : "failed"}>
                    <Terminal size={11} />
                    <b>{acao.name}</b>
                    <span>{acao.resumo || acao.detail}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            <p>{message.content}</p>
          </article>
        ))}

        {/* Execução em curso: a narração e as ações aparecem ao vivo. */}
        {pending ? (
          <article className="console-turn assistant emcurso">
            <small>JARVIS</small>

            {narracao ? <p className="narracao">{narracao}</p> : null}

            {acoesEmCurso.length > 0 ? (
              <ul className="turn-actions rodando">
                {acoesEmCurso.map((acao) => (
                  <li key={acao.acaoId}>
                    <Loader2 size={11} className="spin" />
                    <b>{acao.ferramenta}</b>
                    <span>{acao.detalhe}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {/*
              A resposta sendo escrita. É rascunho: some quando a resposta de
              verdade chega, e é descartada se o texto se revelar narração.
            */}
            {respostaParcial ? <p className="rascunho">{respostaParcial}</p> : null}

            {!narracao && !respostaParcial && acoesEmCurso.length === 0 ? (
              <p className="pensando">
                <Loader2 size={13} className="spin" /> pensando…
              </p>
            ) : null}
          </article>
        ) : null}

        {/* Pergunta aberta: a execução está parada esperando esta resposta. */}
        {pergunta ? (
          <div className={`pergunta-card nivel-${pergunta.nivel}`} role="alertdialog">
            <div className="pergunta-topo">
              {pergunta.nivel === "normal" ? (
                <Terminal size={13} />
              ) : (
                <ShieldAlert size={13} />
              )}
              <span>
                {pergunta.nivel === "critico"
                  ? "AÇÃO CRÍTICA"
                  : pergunta.nivel === "destrutivo"
                    ? "AÇÃO DESTRUTIVA"
                    : "PRECISO DE UMA DECISÃO"}
              </span>
            </div>

            <p className="pergunta-texto">{pergunta.pergunta}</p>
            {pergunta.impacto ? <p className="pergunta-impacto">{pergunta.impacto}</p> : null}
            {pergunta.detalheTecnico ? (
              <pre className="pergunta-tecnico">{pergunta.detalheTecnico}</pre>
            ) : null}

            <div className="pergunta-opcoes">
              {pergunta.opcoes.map((opcao) => (
                <button
                  key={opcao.id}
                  type="button"
                  className={opcao.perigo ? "perigo" : ""}
                  onClick={() => responder({ opcaoId: opcao.id, origem: "clique" })}
                  title={opcao.detalhe}
                >
                  {opcao.rotulo}
                  {opcao.detalhe ? <small>{opcao.detalhe}</small> : null}
                </button>
              ))}
            </div>

            {pergunta.tipo === "confirmacao" ? (
              <p className="pergunta-nota">
                Ações destrutivas só são autorizadas por clique — responder por voz não confirma.
              </p>
            ) : null}
          </div>
        ) : null}

        {voice.interim ? <div className="console-interim">{voice.interim}</div> : null}
      </div>

      {error ? (
        <div className="console-alert" role="alert">
          <AlertTriangle size={14} />
          <div>
            <p>{error.message}</p>
            {error.retryable ? (
              <button type="button" onClick={retryLast} disabled={pending || restam > 0}>
                <RotateCcw size={12} />{" "}
                {restam > 0 ? `Reenviando em ${restam}s` : "Reenviar a última pergunta"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {voice.error ? (
        <div className="console-alert" role="alert">
          <AlertTriangle size={14} />
          <p>{voice.error}</p>
        </div>
      ) : null}

      <form
        className="console-composer"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={composerRef}
          value={draft}
          rows={2}
          placeholder={pending ? "Mandar outra ordem interrompe a atual…" : "Escreva uma ordem…"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // O envio continua habilitado durante a execução: uma ordem nova
            // cancela a anterior, em vez de ser engolida.
            if (
              shouldSubmitComposer({
                key: event.key,
                shiftKey: event.shiftKey,
                hasMessage: draft.trim().length > 0,
                isPending: false,
              })
            ) {
              event.preventDefault();
              submit();
            }
          }}
        />

        <button type="submit" className="console-send" disabled={!draft.trim()}>
          <Send size={14} />
          ENVIAR
        </button>
      </form>
    </section>
  );
}
