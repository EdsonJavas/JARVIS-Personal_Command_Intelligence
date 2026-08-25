import { CircleCheck, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useJarvisSession } from "@/contexts/JarvisSessionContext";

/**
 * A coluna esquerda: o que ele faz, e o estado da máquina onde faz.
 *
 * Sem molduras — são leituras alinhadas à margem, como marcações de instrumento.
 * A tela vazia parecia uma proteção de tela; isto a torna um posto de comando,
 * usando dado que o servidor já mede e que antes só existia na outra janela.
 *
 * O que entra aqui passou por um filtro: serve para decidir alguma coisa. Uso de
 * CPU e espaço em disco mudam o que se pede ao Jarvis; a versão da BIOS, não.
 */

const POLL_MS = 2000;
const PERMANENCIA_MS = 6000;
const MAX_CONCLUIDAS = 4;

type Concluida = { ferramenta: string; detalhe: string };

/** Barra fina de porcentagem. Verde até 60, âmbar até 85, alerta acima. */
function Medida({ rotulo, valor, detalhe }: { rotulo: string; valor: number | null; detalhe?: string }) {
  const pct = valor ?? 0;
  const tom = pct >= 85 ? "alto" : pct >= 60 ? "medio" : "baixo";

  return (
    <div className="medida">
      <span className="medida-nome">{rotulo}</span>
      <div className="medida-trilho">
        <i className={tom} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      <b className={tom}>{valor === null ? "—" : Math.round(valor)}</b>
      {detalhe ? <em>{detalhe}</em> : null}
    </div>
  );
}

function taxa(bytes: number | null): string {
  if (!bytes) return "0";
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)}M`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}K`;
  return `${Math.round(bytes)}B`;
}

function tempoDeAtividade(segundos: number): string {
  const dias = Math.floor(segundos / 86400);
  const horas = Math.floor((segundos % 86400) / 3600);
  const minutos = Math.floor((segundos % 3600) / 60);
  return dias > 0 ? `${dias}d ${horas}h` : `${horas}h ${String(minutos).padStart(2, "0")}m`;
}

export function ColunaEsquerda() {
  const { acoesEmCurso, messages } = useJarvisSession();
  const [agora, setAgora] = useState(() => Date.now());
  const [concluidas, setConcluidas] = useState<Concluida[]>([]);

  const { data: maquina } = trpc.machine.stats.useQuery(undefined, {
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: false,
    retry: false,
  });

  // Relógio próprio: o cronômetro de "3s" precisa avançar mesmo com o resto da
  // página parada.
  useEffect(() => {
    if (acoesEmCurso.length === 0) return;
    const timer = window.setInterval(() => setAgora(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [acoesEmCurso.length]);

  const ultima = messages[messages.length - 1];
  useEffect(() => {
    if (ultima?.role !== "assistant" || !ultima.acoes?.length) return;
    setConcluidas(
      ultima.acoes.slice(-MAX_CONCLUIDAS).map((acao) => ({
        ferramenta: acao.name,
        detalhe: acao.resumo ?? acao.detail,
      }))
    );
    const timer = window.setTimeout(() => setConcluidas([]), PERMANENCIA_MS);
    return () => window.clearTimeout(timer);
  }, [messages.length]);

  const disco = maquina?.disks.find((d) => d.name.startsWith("C")) ?? maquina?.disks[0];
  const rede = (maquina?.network ?? []).reduce(
    (soma, n) => ({ rx: soma.rx + (n.rxPerSecond ?? 0), tx: soma.tx + (n.txPerSecond ?? 0) }),
    { rx: 0, tx: 0 }
  );

  return (
    <div className="coluna esquerda">
      {/* ------------------------------------------------ execução */}
      <section className="bloco">
        <h3>
          EXECUÇÃO
          <i className={acoesEmCurso.length > 0 ? "vivo" : ""} />
        </h3>

        {acoesEmCurso.length === 0 && concluidas.length === 0 ? (
          <p className="vazio-linha">ocioso</p>
        ) : null}

        {acoesEmCurso.map((acao) => (
          <div key={acao.acaoId} className="tarefa rodando">
            <Loader2 size={9} className="spin" />
            <b>{acao.ferramenta}</b>
            <em>{Math.max(0, Math.round((agora - acao.iniciadaEm) / 1000))}s</em>
            <span>{acao.detalhe}</span>
          </div>
        ))}

        {concluidas.map((acao, i) => (
          <div key={`${acao.ferramenta}-${i}`} className="tarefa feita">
            <CircleCheck size={9} />
            <b>{acao.ferramenta}</b>
            <em />
            <span>{acao.detalhe}</span>
          </div>
        ))}
      </section>

      {/* ------------------------------------------------ vitais */}
      <section className="bloco">
        <h3>
          MÁQUINA
          <i />
        </h3>

        <Medida
          rotulo="CPU"
          valor={maquina?.cpu.usagePercent ?? null}
          detalhe={maquina ? `${maquina.cpu.cores}n` : undefined}
        />
        <Medida
          rotulo="MEM"
          valor={maquina?.memory.usedPercent ?? null}
          detalhe={
            maquina ? `${(maquina.memory.usedBytes / 1024 ** 3).toFixed(1)}G` : undefined
          }
        />
        <Medida
          rotulo="GPU"
          valor={maquina?.gpu.usagePercent ?? null}
        />
        <Medida
          rotulo={disco ? `DSK ${disco.name.replace(":", "")}` : "DSK"}
          valor={disco?.usedPercent ?? null}
          detalhe={disco ? `${(disco.freeBytes / 1024 ** 3).toFixed(0)}G livre` : undefined}
        />

        <div className="linha-dupla">
          <span>REDE</span>
          <b>
            ↓{taxa(rede.rx)} ↑{taxa(rede.tx)}
          </b>
        </div>
        <div className="linha-dupla">
          <span>ATIVO</span>
          <b>{maquina ? tempoDeAtividade(maquina.host.uptimeSeconds) : "—"}</b>
        </div>
        <div className="linha-dupla">
          <span>PROC</span>
          <b>
            {maquina?.processCount ?? "—"}
            {maquina?.battery ? ` · ${maquina.battery.percent}%${maquina.battery.charging ? "⚡" : ""}` : ""}
          </b>
        </div>
      </section>
    </div>
  );
}
