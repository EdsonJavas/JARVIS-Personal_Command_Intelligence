import { useEffect, useMemo, useState } from "react";
import { Check, Cloud, Cpu, Play, Sparkles, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import {
  FRASE_DE_TESTE,
  guardarVozEscolhida,
  lerVozEscolhida,
  nomeCurto,
  qualidadeDaVoz,
  vozesParaEscolher,
} from "@/lib/vozEscolhida";

/**
 * Seletor de voz, com prova de ouvido.
 *
 * A escolha automática errou três vezes: a máquina do Senhor Edson só tinha a
 * "Maria Desktop", da geração mais antiga do Windows, e qualquer heurística que
 * exigisse voz em português acabava nela. Nenhuma regra sabe o que soa bem — ele
 * sabe. Aqui ele ouve cada uma dizendo a mesma frase e aponta.
 */

export function EscolherVoz({ aoFechar }: { aoFechar: () => void }) {
  const [vozes, setVozes] = useState<SpeechSynthesisVoice[]>([]);
  const [escolhida, setEscolhida] = useState<string | null>(() => lerVozEscolhida());
  const [tocando, setTocando] = useState<string | null>(null);

  // As vozes do SERVIDOR: rodam na máquina, sem cota e iguais em qualquer
  // navegador. Quando existem, são a melhor opção da lista.
  const { data: doServidor } = trpc.jarvis.vozes.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const falarNoServidor = trpc.jarvis.speak.useMutation();

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    // A lista chega assíncrona: no primeiro render costuma vir vazia.
    const carregar = () => setVozes(window.speechSynthesis.getVoices());
    carregar();
    window.speechSynthesis.addEventListener("voiceschanged", carregar);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", carregar);
  }, []);

  // Ao fechar, o que estiver falando para: sair com a amostra tocando por cima
  // da conversa seria pior que não ter ouvido.
  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  const emPortugues = useMemo(() => vozesParaEscolher(vozes), [vozes]);
  const neurais = emPortugues.filter((voz) => qualidadeDaVoz(voz) === "neural");
  const antigas = emPortugues.filter((voz) => qualidadeDaVoz(voz) === "antiga");

  const ouvir = (voz: SpeechSynthesisVoice) => {
    window.speechSynthesis.cancel();
    const fala = new SpeechSynthesisUtterance(FRASE_DE_TESTE);
    fala.voice = voz;
    fala.lang = voz.lang;
    // Voz neural não leva correção de tom: deslocar o pitch introduz justamente
    // o artefato metálico que se quer evitar.
    const neural = qualidadeDaVoz(voz) === "neural";
    fala.rate = neural ? 1 : 0.98;
    fala.pitch = neural ? 1 : 0.92;
    fala.onend = () => setTocando(null);
    fala.onerror = () => setTocando(null);
    setTocando(voz.name);
    window.speechSynthesis.speak(fala);
  };

  /** Toca uma voz do servidor. O áudio vem em WAV base64. */
  const ouvirDoServidor = async (vozId: string) => {
    window.speechSynthesis?.cancel();
    setTocando(vozId);
    try {
      const r = await falarNoServidor.mutateAsync({ text: FRASE_DE_TESTE, voz: vozId });
      const audio = new Audio(`data:${r.mimeType};base64,${r.audio}`);
      audio.onended = () => setTocando(null);
      audio.onerror = () => setTocando(null);
      await audio.play();
    } catch {
      setTocando(null);
    }
  };

  const usar = (nome: string | null) => {
    guardarVozEscolhida(nome);
    setEscolhida(nome);
  };

  const Linha = ({ voz }: { voz: SpeechSynthesisVoice }) => {
    const ativa = escolhida === voz.name;
    return (
      <article className={ativa ? "voz-linha ativa" : "voz-linha"}>
        <button type="button" className="voz-ouvir" onClick={() => ouvir(voz)} aria-label={`Ouvir ${voz.name}`}>
          <Play size={11} />
        </button>
        <div>
          <strong>{nomeCurto(voz)}</strong>
          <small>{voz.name}</small>
        </div>
        {tocando === voz.name ? <em className="voz-tocando">falando…</em> : null}
        <button type="button" className="voz-usar" onClick={() => usar(voz.name)} disabled={ativa}>
          {ativa ? <Check size={12} /> : "usar"}
        </button>
      </article>
    );
  };

  return (
    <div className="voz-painel" role="dialog" aria-label="Escolher a voz do Jarvis">
      <header>
        <h2>A VOZ DO JARVIS</h2>
        <button type="button" onClick={aoFechar} aria-label="Fechar">
          <X size={14} />
        </button>
      </header>

      <p className="voz-dica">
        Ouça cada uma dizendo a mesma frase e escolha a que soar melhor. A escolha fica guardada
        neste navegador.
      </p>

      {doServidor?.microsoft && doServidor.microsoft.length > 0 ? (
        <section>
          <h3>
            <Cloud size={11} /> NEURAIS DA MICROSOFT — as mais humanas, sem cota
          </h3>
          {doServidor.microsoft.map((voz) => {
            const ativa = escolhida === `servidor:${voz.id}`;
            return (
              <article key={voz.id} className={ativa ? "voz-linha ativa" : "voz-linha"}>
                <button
                  type="button"
                  className="voz-ouvir"
                  onClick={() => ouvirDoServidor(voz.id)}
                  aria-label={`Ouvir ${voz.nome}`}
                >
                  <Play size={11} />
                </button>
                <div>
                  <strong>{voz.nome}</strong>
                  <small>{voz.genero === "Male" ? "masculina" : "feminina"} · precisa de internet</small>
                </div>
                {tocando === voz.id ? <em className="voz-tocando">falando…</em> : null}
                <button
                  type="button"
                  className="voz-usar"
                  onClick={() => usar(`servidor:${voz.id}`)}
                  disabled={ativa}
                >
                  {ativa ? <Check size={12} /> : "usar"}
                </button>
              </article>
            );
          })}
        </section>
      ) : null}

      {doServidor?.localDisponivel && doServidor.vozes.length > 0 ? (
        <section>
          <h3>
            <Cpu size={11} /> NA SUA MÁQUINA — funcionam offline, reserva das de cima
          </h3>
          {doServidor.vozes.map((voz) => {
            const ativa = escolhida === `servidor:${voz.id}`;
            return (
              <article key={voz.id} className={ativa ? "voz-linha ativa" : "voz-linha"}>
                <button
                  type="button"
                  className="voz-ouvir"
                  onClick={() => ouvirDoServidor(voz.id)}
                  aria-label={`Ouvir ${voz.nome}`}
                >
                  <Play size={11} />
                </button>
                <div>
                  <strong>{voz.nome}</strong>
                  <small>síntese neural local</small>
                </div>
                {tocando === voz.id ? <em className="voz-tocando">falando…</em> : null}
                <button
                  type="button"
                  className="voz-usar"
                  onClick={() => usar(`servidor:${voz.id}`)}
                  disabled={ativa}
                >
                  {ativa ? <Check size={12} /> : "usar"}
                </button>
              </article>
            );
          })}
        </section>
      ) : null}

      {neurais.length > 0 ? (
        <section>
          <h3>
            <Sparkles size={11} /> NEURAIS — soam humanas, sem limite de uso
          </h3>
          {neurais.map((voz) => (
            <Linha key={voz.name} voz={voz} />
          ))}
        </section>
      ) : (
        <section>
          <h3>NENHUMA VOZ NEURAL NESTE NAVEGADOR</h3>
          <p className="voz-aviso">
            As vozes neurais da Microsoft aparecem no <b>Microsoft Edge</b>. Abrindo o Jarvis por
            lá, esta lista ganha as vozes “Online (Natural)”, que são as boas — gratuitas e sem
            limite. Outro caminho é instalar vozes naturais em <b>Configurações › Acessibilidade ›
            Narrador › Adicionar vozes naturais</b>, e aí elas valem em qualquer navegador.
          </p>
        </section>
      )}

      {antigas.length > 0 ? (
        <section>
          <h3>ANTIGAS — a síntese metálica do Windows</h3>
          {antigas.map((voz) => (
            <Linha key={voz.name} voz={voz} />
          ))}
        </section>
      ) : null}

      {escolhida ? (
        <footer>
          <span>Escolhida: {escolhida}</span>
          <button type="button" onClick={() => usar(null)}>
            voltar ao automático
          </button>
        </footer>
      ) : null}
    </div>
  );
}
