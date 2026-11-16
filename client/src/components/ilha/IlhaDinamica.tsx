import { useEffect, useRef, useState } from "react";
import { AlertTriangle, BellRing, CalendarClock, Square, TriangleAlert, X } from "lucide-react";
import { useJarvisSession, type ConsoleError } from "@/contexts/JarvisSessionContext";
import type { IniciativaNaTela } from "@/hooks/useIniciativas";
import { atividadeDaIlha, formaDaIlha } from "@/lib/ilhaEstado";
import { CascaDaIlha, useAbertura } from "./CascaDaIlha";
import { MiniSistema } from "./MiniSistema";
import { BarrasIlha, OrbeIlha } from "./Instrumentos";

/**
 * O Jarvis morando no alto da tela.
 *
 * Quatro formas, escolhidas sozinhas pelo que está acontecendo (ver
 * lib/ilhaEstado.ts): repouso, atividade, aviso e expandida.
 */

/** Quanto tempo um recado passageiro fica, sem o mouse em cima. */
const AVISO_DE_INICIATIVA_MS = 9_000;
const AVISO_DE_ERRO_MS = 6_000;

type Aviso =
  | { tipo: "iniciativa"; iniciativa: IniciativaNaTela }
  | { tipo: "erro"; erro: ConsoleError };

/**
 * O recado que chegou sozinho, mostrado por alguns segundos.
 *
 * Cada iniciativa aparece UMA vez: dispensar a mais nova faz a anterior virar a
 * primeira da lista, e sem a memória do que já foi mostrado ela ressurgiria
 * como se tivesse acabado de chegar. Com o mouse em cima, o tempo para — o dono
 * está lendo.
 */
function useAvisoPassageiro(
  iniciativas: IniciativaNaTela[],
  erro: ConsoleError | null,
  pausado: boolean
) {
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const jaMostradas = useRef(new Set<string>());

  const maisNova = iniciativas[0];
  const chaveDaMaisNova = maisNova ? `${maisNova.compromissoId}-${maisNova.em}` : null;

  useEffect(() => {
    if (!maisNova || !chaveDaMaisNova || jaMostradas.current.has(chaveDaMaisNova)) return;
    jaMostradas.current.add(chaveDaMaisNova);
    setAviso({ tipo: "iniciativa", iniciativa: maisNova });
    // Só a chave: a lista muda de identidade a cada render sem que nada chegue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveDaMaisNova]);

  useEffect(() => {
    if (erro) setAviso({ tipo: "erro", erro });
    else setAviso((atual) => (atual?.tipo === "erro" ? null : atual));
  }, [erro]);

  // Dispensada por outro caminho (na ilha aberta, por exemplo): sai daqui também.
  useEffect(() => {
    if (aviso?.tipo !== "iniciativa") return;
    const aindaExiste = iniciativas.some(
      (item) => item.compromissoId === aviso.iniciativa.compromissoId
    );
    if (!aindaExiste) setAviso(null);
  }, [iniciativas, aviso]);

  useEffect(() => {
    if (!aviso || pausado) return;
    const espera = aviso.tipo === "erro" ? AVISO_DE_ERRO_MS : AVISO_DE_INICIATIVA_MS;
    const timer = window.setTimeout(() => setAviso(null), espera);
    return () => window.clearTimeout(timer);
  }, [aviso, pausado]);

  return { aviso, encerrarAviso: () => setAviso(null) };
}

const ICONES = { lembrete: BellRing, rotina: CalendarClock, vigia: TriangleAlert } as const;
const ROTULOS = { lembrete: "LEMBRETE", rotina: "ROTINA", vigia: "ATENÇÃO" } as const;

export function IlhaDinamica() {
  const sessao = useJarvisSession();
  const { aberta, abrir } = useAbertura();
  const [sobre, setSobre] = useState(false);
  const { aviso, encerrarAviso } = useAvisoPassageiro(sessao.iniciativas, sessao.error, sobre);

  const ultima = sessao.messages[sessao.messages.length - 1];
  const atividade = atividadeDaIlha({
    pending: sessao.pending,
    narracao: sessao.narracao,
    respostaParcial: sessao.respostaParcial,
    acoesEmCurso: sessao.acoesEmCurso,
    aoVivoAtivo: sessao.aoVivo.ativo,
    aoVivoConectando: sessao.aoVivo.conectando,
    aoVivoFalando: sessao.aoVivo.falando,
    vozFalando: sessao.voice.speaking,
    ultimaResposta: ultima?.role === "assistant" ? ultima.content : null,
  });

  const forma = formaDaIlha({
    abertaPeloDono: aberta,
    temPergunta: Boolean(sessao.pergunta),
    aviso: aviso?.tipo ?? null,
    emAtividade: atividade !== null,
  });

  /*
   * A chave decide quando o conteúdo troca com desfoque. Na atividade, só o
   * TIPO entra nela: o texto muda a cada palavra que chega, e trocar com
   * desfoque a cada palavra seria tremer, não animar.
   */
  const chave =
    forma === "atividade"
      ? `atividade-${atividade?.tipo}`
      : forma === "aviso"
        ? `aviso-${aviso?.tipo === "iniciativa" ? aviso.iniciativa.compromissoId : "erro"}`
        : forma;

  const pendentes = sessao.iniciativas.length;

  return (
    <CascaDaIlha
      forma={forma}
      chave={chave}
      rotulo="JARVIS"
      aoClicar={abrir}
      aoPairar={setSobre}
    >
      {forma === "expandida" ? (
        <MiniSistema />
      ) : forma === "aviso" && aviso ? (
        aviso.tipo === "iniciativa" ? (
          <AvisoDeIniciativa
            iniciativa={aviso.iniciativa}
            aoDispensar={() => {
              sessao.dispensarIniciativa(aviso.iniciativa.compromissoId);
              encerrarAviso();
            }}
          />
        ) : (
          <div className="ilha-aviso tipo-erro">
            <span className="ilha-aviso-icone">
              <AlertTriangle size={15} />
            </span>
            <div>
              <header>
                <b>NÃO DEU CERTO</b>
              </header>
              <p>{aviso.erro.message}</p>
            </div>
          </div>
        )
      ) : forma === "atividade" && atividade ? (
        <div className={`ilha-atividade tipo-${atividade.tipo}`}>
          <OrbeIlha tamanho={22} />
          {/* O fim do texto fica sempre à vista: é a palavra que acabou de chegar. */}
          <p className={`ilha-linha ${atividade.texto.startsWith("…") ? "cortada" : ""}`}>
            <span>{atividade.texto.replace(/^…/, "")}</span>
          </p>
          {atividade.tipo === "pensando" ? (
            <button
              type="button"
              className="ilha-botao pequeno"
              onClick={(evento) => {
                evento.stopPropagation();
                sessao.cancelar();
              }}
              title="Interromper"
            >
              <Square size={11} />
            </button>
          ) : atividade.tipo === "conectando" ? null : (
            <>
              <BarrasIlha />
              {sessao.aoVivo.ativo || sessao.voice.speaking ? (
                <button
                  type="button"
                  className="ilha-botao pequeno"
                  onClick={(evento) => {
                    evento.stopPropagation();
                    if (sessao.aoVivo.ativo) sessao.alternarAoVivo();
                    else sessao.voice.stopSpeaking();
                  }}
                  title={sessao.aoVivo.ativo ? "Encerrar a conversa por voz" : "Parar de falar"}
                >
                  <X size={12} />
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : (
        <div className="ilha-repouso">
          <span className="ilha-ponto" aria-hidden="true" />
          <span className="ilha-marca">JARVIS</span>
          {pendentes > 0 ? (
            <span className="ilha-contagem" title={`${pendentes} aviso(s) esperando`}>
              {pendentes}
            </span>
          ) : (
            <span className="ilha-contagem vazia" aria-hidden="true" />
          )}
        </div>
      )}
    </CascaDaIlha>
  );
}

function AvisoDeIniciativa({
  iniciativa,
  aoDispensar,
}: {
  iniciativa: IniciativaNaTela;
  aoDispensar: () => void;
}) {
  const Icone = ICONES[iniciativa.tipo];
  return (
    <div className={`ilha-aviso tipo-${iniciativa.tipo}`}>
      <span className="ilha-aviso-icone">
        <Icone size={15} />
      </span>
      <div>
        <header>
          <b>{ROTULOS[iniciativa.tipo]}</b>
          {iniciativa.valor !== undefined ? <em>medido: {Math.round(iniciativa.valor)}%</em> : null}
        </header>
        {/* Pelo começo, cortado em duas linhas no CSS: num lembrete, o que
            importa vem primeiro. */}
        <p>{iniciativa.texto}</p>
      </div>
      <button
        type="button"
        className="ilha-botao pequeno"
        onClick={(evento) => {
          evento.stopPropagation();
          aoDispensar();
        }}
        title="Dispensar"
      >
        <X size={12} />
      </button>
    </div>
  );
}
