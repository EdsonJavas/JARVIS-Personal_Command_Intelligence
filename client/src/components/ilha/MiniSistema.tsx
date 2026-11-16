import { useEffect, useState } from "react";
import { LayoutDashboard, Maximize2, Volume2, VolumeX } from "lucide-react";
import { useJarvisSession } from "@/contexts/JarvisSessionContext";
import { dataPorExtenso, saudacao } from "@/lib/miniSistema";
import { desktop } from "@/lib/desktop";
import { OrbeIlha } from "./Instrumentos";
import { AbaHoje } from "./AbaHoje";
import { AbaLembretes } from "./AbaLembretes";
import { AbaMemoria } from "./AbaMemoria";

/**
 * O mini sistema: o que abre quando o dono toca na ilha.
 *
 * Três lugares, os de um assistente pessoal — o dia dele, o que ficou de ser
 * lembrado, e o que o Jarvis sabe sobre ele. Nada de medir a máquina: isso o
 * Windows já mostra. Conversar é na Ponte, a um botão daqui.
 *
 * Altura fixa de propósito: trocar de aba não pode fazer a ilha encolher e
 * crescer, senão cada clique vira uma animação de tamanho.
 */

const ABAS = [
  { id: "hoje", rotulo: "Hoje" },
  { id: "lembretes", rotulo: "Lembretes" },
  { id: "memoria", rotulo: "Memória" },
] as const;

type Aba = (typeof ABAS)[number]["id"];

/** A aba sobrevive ao fechar e abrir, enquanto a ilha estiver viva. */
let ultimaAba: Aba = "hoje";

/** Vira junto com o minuto do relógio do Windows, não meio minuto depois. */
function useRelogio() {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const ate = 60_000 - (Date.now() % 60_000) + 50;
    const timer = window.setTimeout(() => setAgora(new Date()), ate);
    return () => window.clearTimeout(timer);
  }, [agora]);
  return agora;
}

export function MiniSistema() {
  const { voice } = useJarvisSession();
  const [aba, setAba] = useState<Aba>(ultimaAba);
  const agora = useRelogio();

  const escolher = (nova: Aba) => {
    ultimaAba = nova;
    setAba(nova);
  };

  const indice = ABAS.findIndex((a) => a.id === aba);

  return (
    <div className="mini">
      <header className="mini-topo">
        <OrbeIlha tamanho={30} />
        <div className="mini-saudacao">
          <b>{saudacao(agora)}, senhor.</b>
          <span>
            {dataPorExtenso(agora)} ·{" "}
            {agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        <div className="ilha-acoes">
          <button
            type="button"
            className={`ilha-botao ${voice.speechEnabled ? "" : "desligado"}`}
            onClick={() => {
              voice.stopSpeaking();
              voice.setSpeechEnabled((ligada) => !ligada);
            }}
            title={voice.speechEnabled ? "Lembretes falados em voz alta" : "Lembretes em silêncio"}
            aria-pressed={voice.speechEnabled}
          >
            {voice.speechEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </button>
          <button
            type="button"
            className="ilha-botao"
            onClick={() => desktop.abrir("painel")}
            title="Abrir o painel"
          >
            <LayoutDashboard size={14} />
          </button>
          <button
            type="button"
            className="ilha-botao"
            onClick={() => desktop.abrir("ponte")}
            title="Conversar com o Jarvis, na Ponte"
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </header>

      <nav className="mini-abas" role="tablist" aria-label="Seções">
        <span
          className="mini-abas-marca"
          style={{ transform: `translateX(${indice * 100}%)` }}
          aria-hidden="true"
        />
        {ABAS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={aba === item.id}
            className={aba === item.id ? "ativa" : ""}
            onClick={() => escolher(item.id)}
          >
            {item.rotulo}
          </button>
        ))}
      </nav>

      <div className="mini-corpo" role="tabpanel">
        {aba === "hoje" ? <AbaHoje agora={agora} /> : null}
        {aba === "lembretes" ? <AbaLembretes agora={agora} /> : null}
        {aba === "memoria" ? <AbaMemoria /> : null}
      </div>
    </div>
  );
}
