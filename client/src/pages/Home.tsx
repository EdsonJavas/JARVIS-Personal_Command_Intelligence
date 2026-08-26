// JARVIS 2.0 — flush.
//
// Nada de seções encapsuladas: o núcleo ocupa o centro, a transcrição corre no
// alto como legenda, a onda vive pequena num canto e a execução sussurra no
// rodapé. Tudo sobre o mesmo fundo, sem molduras. A conversa fica FECHADA por
// padrão e só aparece quando chamada — é ela que roubava o espaço do principal.
import { useState } from "react";
import {
  AudioLines,
  Ear,
  LayoutDashboard,
  MessageSquare,
  Mic,
  Power,
  TriangleAlert,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { NucleoJarvis } from "@/components/NucleoJarvis";
import { OndaDeVoz } from "@/components/OndaDeVoz";
import { Transcricao } from "@/components/Transcricao";
import { ColunaEsquerda } from "@/components/ColunaEsquerda";
import { ColunaDireita } from "@/components/ColunaDireita";
import { JarvisConsole } from "@/components/JarvisConsole";
import { IniciativasDoJarvis } from "@/components/IniciativasDoJarvis";
import { EscolherVoz } from "@/components/EscolherVoz";
import { JarvisSessionProvider, useJarvisSession } from "@/contexts/JarvisSessionContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { LOGIN_PATH, openBoardWindow } from "@/const";

function Ponte({ onLogout }: { onLogout: () => void }) {
  const { voice, coreState, pergunta, pending } = useJarvisSession();
  const [conversaAberta, setConversaAberta] = useState(false);
  const [escolhendoVoz, setEscolhendoVoz] = useState(false);

  /*
   * A conversa se abre sozinha quando ele PERGUNTA.
   *
   * Uma pergunta com a conversa fechada ficaria esperando resposta numa tela
   * que não a mostra: a execução paralisada e o dono sem saber por quê.
   */
  const mostrarConversa = conversaAberta || Boolean(pergunta);

  return (
    <main className={`ponte ${mostrarConversa ? "com-conversa" : ""}`}>
      <div className="ponte-grao" aria-hidden="true" />
      <div className="ponte-brilho" aria-hidden="true" />

      {/* Alto da tela: o que ele diz, correndo como legenda. Sem caixa. */}
      <Transcricao />

      {/* Canto superior direito: a onda, pequena. */}
      <OndaDeVoz />

      <IniciativasDoJarvis />

      {/* Margem esquerda: o que ele faz, e a máquina onde faz. */}
      <ColunaEsquerda />

      {/* Margem direita: o mundo lá fora, e o que está marcado. */}
      <ColunaDireita />

      {/* Centro: ele. */}
      <div className="palco">
        <NucleoJarvis />
      </div>

      <div className="comandos">
        <button
          type="button"
          className={voice.mode === "dictation" ? "ativo" : ""}
          onClick={() => voice.toggleMode("dictation")}
          disabled={!voice.recognitionSupported}
          title="Ditar uma ordem"
          aria-label="Ditar uma ordem"
        >
          <Mic size={14} />
        </button>

        <button
          type="button"
          className={voice.mode === "wake" ? "ativo" : ""}
          onClick={() => voice.toggleMode("wake")}
          disabled={!voice.recognitionSupported}
          title='Escuta contínua pela palavra "Jarvis"'
          aria-label="Escuta contínua"
        >
          <Ear size={14} />
        </button>

        <button
          type="button"
          className={voice.speechEnabled ? "ativo" : ""}
          onClick={() => {
            voice.stopSpeaking();
            voice.setSpeechEnabled((ligada) => !ligada);
          }}
          title={voice.speechEnabled ? "Resposta falada ligada" : "Resposta falada desligada"}
          aria-label="Resposta falada"
        >
          {voice.speechEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
        </button>

        <button
          type="button"
          className={escolhendoVoz ? "ativo" : ""}
          onClick={() => setEscolhendoVoz((aberto) => !aberto)}
          title="Escolher a voz do Jarvis"
          aria-label="Escolher a voz"
        >
          <AudioLines size={14} />
        </button>

        {voice.voiceWarning ? (
          <button
            type="button"
            className="alerta"
            onClick={() => setEscolhendoVoz(true)}
            title={voice.voiceWarning}
            aria-label="Aviso sobre a voz"
          >
            <TriangleAlert size={12} />
          </button>
        ) : null}

        <span className="comandos-divisor" />

        <button
          type="button"
          className={mostrarConversa ? "ativo" : ""}
          onClick={() => setConversaAberta((aberta) => !aberta)}
          title={mostrarConversa ? "Fechar a conversa" : "Abrir a conversa"}
          aria-label="Conversa"
          aria-expanded={mostrarConversa}
        >
          {mostrarConversa ? <X size={14} /> : <MessageSquare size={14} />}
          {/* Um ponto avisa que há algo acontecendo com a conversa fechada. */}
          {!mostrarConversa && pending ? <i className="ponto" /> : null}
        </button>

        <button type="button" onClick={openBoardWindow} title="Abrir o painel" aria-label="Abrir painel">
          <LayoutDashboard size={14} />
        </button>

        <button
          type="button"
          className="sair"
          onClick={onLogout}
          title="Encerrar sessão"
          aria-label="Encerrar sessão"
        >
          <Power size={14} />
        </button>
      </div>

      {/* A conversa entra por cima, sem empurrar o centro de lugar. */}
      <aside className={`gaveta ${mostrarConversa ? "aberta" : ""}`} aria-hidden={!mostrarConversa}>
        <JarvisConsole />
      </aside>

      {escolhendoVoz ? (
        <EscolherVoz
          aoFechar={() => {
            setEscolhendoVoz(false);
            voice.recarregarVozPreferida();
          }}
        />
      ) : null}

      <span className={`marca-estado estado-${coreState}`}>
        {coreState === "speaking"
          ? "falando"
          : coreState === "listening"
            ? "ouvindo"
            : coreState === "thinking"
              ? "processando"
              : ""}
      </span>
    </main>
  );
}

export default function Home() {
  const { user, loading, logout } = useAuth({
    redirectOnUnauthenticated: true,
    redirectPath: LOGIN_PATH,
  });

  if (loading || !user) {
    return (
      <main className="ponte">
        <div className="boot-state">INICIANDO NÚCLEO…</div>
      </main>
    );
  }

  return (
    <JarvisSessionProvider>
      <Ponte onLogout={() => logout()} />
    </JarvisSessionProvider>
  );
}
