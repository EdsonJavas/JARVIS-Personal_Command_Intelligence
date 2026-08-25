// Painel de instrumentos. É a segunda janela do Jarvis: ele lê o que está aqui
// e escreve na faixa de cartões, então a tela não é só telemetria — é a
// superfície de trabalho dele.
//
// A máquina ocupa uma faixa condensada no topo. O resto do espaço é do que
// serve para trabalhar: o mundo lá fora, o estado dos repositórios, e o que o
// Jarvis deixou. Rola, porque o conteúdo cresce.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  BrainCircuit,
  CloudSun,
  Cpu,
  FileClock,
  GitBranch,
  HardDrive,
  MemoryStick,
  MonitorCog,
  Newspaper,
  Plug,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Trash2,
  Undo2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { LOGIN_PATH } from "@/const";

const POLL_MAQUINA_MS = 1500;
const POLL_MUNDO_MS = 5 * 60 * 1000;
const POLL_DEV_MS = 60 * 1000;
/** Os cartões chegam por pedido do dono ao Jarvis: precisam aparecer rápido. */
const POLL_CARTOES_MS = 4000;
/**
 * Enquanto o servidor ainda não tem o dado.
 *
 * Os coletores do servidor devolvem o cache na hora e vão buscar em segundo
 * plano, então a PRIMEIRA resposta vem vazia por construção. No intervalo
 * normal, um painel recém-aberto ficaria escrito "consultando…" por cinco
 * minutos inteiros. Enquanto vier vazio, insiste rápido; assim que encher, cai
 * para o ritmo normal.
 */
const POLL_AQUECENDO_MS = 3000;
const HISTORICO = 150;
/** Quantos repositórios cabem antes de a lista virar paredão vertical. */
const MAX_REPOS = 6;

/* --------------------------------- formato --------------------------------- */

function gb(bytes: number) {
  return (bytes / 1024 ** 3).toFixed(1);
}

function taxaBytes(valor: number | null) {
  if (valor === null) return "—";
  if (valor >= 1024 ** 2) return `${(valor / 1024 ** 2).toFixed(1)} MB/s`;
  if (valor >= 1024) return `${(valor / 1024).toFixed(0)} KB/s`;
  return `${Math.round(valor)} B/s`;
}

function tamanho(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function compacto(valor: number | null) {
  if (valor === null) return "—";
  if (valor >= 1e6) return `${(valor / 1e6).toFixed(1)}M`;
  if (valor >= 1e3) return `${(valor / 1e3).toFixed(1)}k`;
  return String(Math.round(valor));
}

function tempoDeAtividade(segundos: number) {
  const dias = Math.floor(segundos / 86400);
  const horas = Math.floor((segundos % 86400) / 3600);
  const minutos = Math.floor((segundos % 3600) / 60);
  if (dias > 0) return `${dias}d ${horas}h ${String(minutos).padStart(2, "0")}m`;
  return `${horas}h ${String(minutos).padStart(2, "0")}m`;
}

/** "há 4 min", "ontem". Data absoluta obriga a fazer conta de cabeça. */
function haQuantoTempo(iso: string | null): string {
  if (!iso) return "—";
  const quando = new Date(iso).getTime();
  if (Number.isNaN(quando)) return "—";

  const segundos = Math.max(0, Math.round((Date.now() - quando) / 1000));
  if (segundos < 60) return "agora";
  if (segundos < 3600) return `há ${Math.floor(segundos / 60)} min`;
  if (segundos < 86400) return `há ${Math.floor(segundos / 3600)} h`;
  const dias = Math.floor(segundos / 86400);
  if (dias === 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;
  return new Date(quando).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function diaDaSemana(data: string): string {
  const dia = new Date(`${data}T12:00:00`);
  if (Number.isNaN(dia.getTime())) return data;
  return dia.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "").toUpperCase();
}

/** Verde até 60%, âmbar até 85%, vermelho acima. Pressão real, não estética. */
function tom(percentual: number) {
  if (percentual >= 85) return "alert";
  if (percentual >= 60) return "amber";
  return "mint";
}

/* ------------------------------ medidor radial ----------------------------- */

function Medidor({
  valor,
  rotulo,
  detalhe,
  icone,
}: {
  valor: number | null;
  rotulo: string;
  detalhe: string;
  icone: React.ReactNode;
}) {
  const tamanhoSvg = 104;
  const centro = tamanhoSvg / 2;
  const raio = tamanhoSvg * 0.32;
  const circunferencia = 2 * Math.PI * raio;
  const varredura = 0.75;

  const marcas = Array.from({ length: 32 }, (_, indice) => {
    const fracao = indice / 31;
    const angulo = (-225 + fracao * 270) * (Math.PI / 180);
    const interno = raio + tamanhoSvg * 0.07;
    const externo = interno + (indice % 5 === 0 ? tamanhoSvg * 0.06 : tamanhoSvg * 0.03);
    return {
      chave: indice,
      x1: centro + Math.cos(angulo) * interno,
      y1: centro + Math.sin(angulo) * interno,
      x2: centro + Math.cos(angulo) * externo,
      y2: centro + Math.sin(angulo) * externo,
      ativa: valor !== null && fracao <= valor / 100,
      maior: indice % 5 === 0,
    };
  });

  return (
    <article className="vital">
      <div className="gauge-body">
        <svg viewBox={`0 0 ${tamanhoSvg} ${tamanhoSvg}`} className="gauge-svg" role="img" aria-label={rotulo}>
          {marcas.map((marca) => (
            <line
              key={marca.chave}
              x1={marca.x1}
              y1={marca.y1}
              x2={marca.x2}
              y2={marca.y2}
              className={`gauge-tick ${marca.ativa ? "on" : ""} ${marca.maior ? "major" : ""}`}
            />
          ))}
          <circle
            cx={centro}
            cy={centro}
            r={raio}
            className="gauge-track"
            strokeDasharray={`${circunferencia * varredura} ${circunferencia}`}
            transform={`rotate(135 ${centro} ${centro})`}
          />
          <circle
            cx={centro}
            cy={centro}
            r={raio}
            className="gauge-arc"
            strokeDasharray={`${circunferencia * varredura * ((valor ?? 0) / 100)} ${circunferencia}`}
            transform={`rotate(135 ${centro} ${centro})`}
          />
        </svg>
        <div className="gauge-value">
          <strong className={valor === null ? "" : tom(valor)}>
            {valor === null ? "—" : Math.round(valor)}
          </strong>
        </div>
      </div>
      <h4>
        {icone} {rotulo}
      </h4>
      <small>{detalhe}</small>
    </article>
  );
}

/* ------------------------- gráfico de área empilhado ------------------------ */

type Serie = { rotulo: string; valores: number[]; classe: string };

function AreaMultipla({ series }: { series: Serie[] }) {
  const largura = 300;
  const altura = 78;

  const caminho = (valores: number[], fechar: boolean) => {
    if (valores.length < 2) return "";
    const pontos = valores.map((valor, indice) => {
      const x = (indice / (HISTORICO - 1)) * largura;
      const y = altura - (Math.min(100, Math.max(0, valor)) / 100) * altura;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const linha = `M${pontos.join(" L")}`;
    if (!fechar) return linha;
    const ultimoX = (((valores.length - 1) / (HISTORICO - 1)) * largura).toFixed(1);
    return `${linha} L${ultimoX},${altura} L0,${altura} Z`;
  };

  return (
    <div className="area-chart">
      <svg viewBox={`0 0 ${largura} ${altura}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="areaFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#ff8a4c" stopOpacity="0.42" />
            <stop offset="1" stopColor="#ff8a4c" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[25, 50, 75].map((linha) => (
          <line
            key={linha}
            x1="0"
            x2={largura}
            y1={altura - (linha / 100) * altura}
            y2={altura - (linha / 100) * altura}
            className="grid-line"
          />
        ))}
        {series[0] ? <path d={caminho(series[0].valores, true)} fill="url(#areaFill)" /> : null}
        {series.map((item) => (
          <path key={item.rotulo} d={caminho(item.valores, false)} className={`series ${item.classe}`} />
        ))}
      </svg>
      <div className="area-legend">
        {series.map((item) => (
          <span key={item.rotulo} className={item.classe}>
            <i /> {item.rotulo}
            <b>
              {item.valores.length ? Math.round(item.valores[item.valores.length - 1]) : "—"}
              <small>%</small>
            </b>
          </span>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------- painel ---------------------------------- */

export default function Dashboard() {
  const { user, loading } = useAuth({ redirectOnUnauthenticated: true, redirectPath: LOGIN_PATH });
  const utils = trpc.useUtils();

  const { data: maquina } = trpc.machine.stats.useQuery(undefined, {
    refetchInterval: POLL_MAQUINA_MS,
    refetchOnWindowFocus: false,
    retry: false,
  });

  // O mundo depende de rede e pode falhar; o painel continua de pé sem ele.
  const { data: mundo, isError: mundoFalhou } = trpc.board.world.useQuery(undefined, {
    refetchInterval: (query) => {
      const dados = query.state.data;
      const vazio = !dados || (dados.clima.temperatura === null && dados.cotacoes.length === 0);
      return vazio ? POLL_AQUECENDO_MS : POLL_MUNDO_MS;
    },
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const { data: dev } = trpc.board.dev.useQuery(undefined, {
    refetchInterval: (query) => {
      const dados = query.state.data;
      const vazio = !dados || (dados.repositorios.length === 0 && dados.portas.length === 0);
      return vazio ? POLL_AQUECENDO_MS : POLL_DEV_MS;
    },
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const { data: cartoes } = trpc.board.cards.useQuery(undefined, {
    refetchInterval: POLL_CARTOES_MS,
    refetchOnWindowFocus: false,
  });

  const { data: memorias } = trpc.memoria.listar.useQuery(undefined, {
    refetchInterval: 15000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const removerCartao = trpc.board.removeCard.useMutation({
    onSuccess: () => utils.board.cards.invalidate(),
  });
  const esquecerMemoria = trpc.memoria.esquecer.useMutation({
    onSuccess: () => utils.memoria.listar.invalidate(),
  });
  const restaurarMemoria = trpc.memoria.restaurar.useMutation({
    onSuccess: () => utils.memoria.listar.invalidate(),
  });

  const [historicoCpu, setHistoricoCpu] = useState<number[]>([]);
  const [historicoMem, setHistoricoMem] = useState<number[]>([]);
  const [historicoGpu, setHistoricoGpu] = useState<number[]>([]);
  const [historicoIo, setHistoricoIo] = useState<number[]>([]);
  const [relogio, setRelogio] = useState(() => new Date());
  const [mostrarEsquecidas, setMostrarEsquecidas] = useState(false);
  const ultimaMarcaRef = useRef<string | null>(null);

  useEffect(() => {
    const temporizador = window.setInterval(() => setRelogio(new Date()), 1000);
    return () => window.clearInterval(temporizador);
  }, []);

  // Só acumula quando a medição é nova: o React Query reentrega o mesmo objeto
  // em rerenders, e isso duplicaria pontos no gráfico.
  useEffect(() => {
    if (!maquina || maquina.measuredAt === ultimaMarcaRef.current) return;
    ultimaMarcaRef.current = maquina.measuredAt;

    const empurrar = (
      definir: (fn: (atual: number[]) => number[]) => void,
      valor: number
    ) => definir((atual) => [...atual, valor].slice(-HISTORICO));

    if (maquina.cpu.usagePercent !== null) empurrar(setHistoricoCpu, maquina.cpu.usagePercent);
    empurrar(setHistoricoMem, maquina.memory.usedPercent);
    if (maquina.gpu.usagePercent !== null) empurrar(setHistoricoGpu, maquina.gpu.usagePercent);
    if (maquina.diskIo.busyPercent !== null) empurrar(setHistoricoIo, maquina.diskIo.busyPercent);
  }, [maquina]);

  const discoPrincipal = useMemo(() => {
    const discos = maquina?.disks ?? [];
    // O disco do sistema é o que importa quando o espaço aperta.
    return discos.find((disco) => disco.name.startsWith("C")) ?? discos[0] ?? null;
  }, [maquina]);

  /**
   * Só os repositórios em movimento.
   *
   * São 23 na máquina, e a maioria está parada há meses. Listados todos, o
   * painel virava um paredão vertical que não dizia nada — e ainda esticava a
   * linha inteira, deixando o que estava ao lado vazio. Movimento é trabalho
   * pendente primeiro, depois quem foi tocado mais recentemente.
   */
  const reposEmMovimento = useMemo(() => {
    const todos = dev?.repositorios ?? [];
    const pendencia = (repo: (typeof todos)[number]) =>
      repo.alterados + repo.naoRastreados + repo.aFrente + repo.atras;

    return [...todos]
      .sort((a, b) => {
        const diferenca = pendencia(b) - pendencia(a);
        if (diferenca !== 0) return diferenca;
        return (b.ultimoCommitEm ?? "").localeCompare(a.ultimoCommitEm ?? "");
      })
      .slice(0, MAX_REPOS);
  }, [dev]);

  const visiveis = useMemo(
    () => (memorias ?? []).filter((memoria) => mostrarEsquecidas || !memoria.esquecida),
    [memorias, mostrarEsquecidas]
  );
  const quantasEsquecidas = (memorias ?? []).filter((memoria) => memoria.esquecida).length;

  if (loading || !user) {
    return (
      <main className="board">
        <div className="boot-state">ABRINDO PAINEL…</div>
      </main>
    );
  }

  const repositorios = dev?.repositorios ?? [];
  const clima = mundo?.clima;

  return (
    <main className="board board-scroll">
      <header className="board-head">
        <div className="board-brand">
          <h1>
            JARVIS <i>//</i> COMMAND CENTER
          </h1>
          <p>
            {maquina?.host.hostname ?? "—"} <i />
            {clima?.local ?? maquina?.host.osName ?? "—"} <i />
            {tempoDeAtividade(maquina?.host.uptimeSeconds ?? 0)} de atividade
          </p>
        </div>

        <div className="board-ticker">
          {[
            {
              rotulo: "CLIMA",
              valor: clima?.temperatura !== null && clima?.temperatura !== undefined
                ? `${Math.round(clima.temperatura)}°`
                : "—",
              tom: "cyan",
            },
            ...(mundo?.cotacoes ?? []).slice(0, 2).map((cotacao) => ({
              rotulo: cotacao.par.replace("-", "/"),
              valor: cotacao.valor.toLocaleString("pt-BR", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }),
              tom: cotacao.variacaoPercentual >= 0 ? "mint" : "alert",
            })),
            {
              rotulo: "REPOS SUJOS",
              valor: String(
                repositorios.filter((repo) => repo.alterados + repo.naoRastreados > 0).length
              ),
              tom: repositorios.some((repo) => repo.alterados + repo.naoRastreados > 0)
                ? "amber"
                : "mint",
            },
            { rotulo: "PORTAS", valor: String(dev?.portas.length ?? "—"), tom: "cyan" },
            { rotulo: "PROCESSOS", valor: String(maquina?.processCount ?? "—"), tom: "muted" },
            {
              rotulo: "ENERGIA",
              valor: maquina?.battery
                ? `${maquina.battery.percent}%${maquina.battery.charging ? " ⚡" : ""}`
                : "TOMADA",
              tom:
                maquina?.battery && !maquina.battery.charging && maquina.battery.percent < 25
                  ? "alert"
                  : "amber",
            },
            {
              rotulo: "RELÓGIO",
              valor: relogio.toLocaleTimeString("pt-BR", { hour12: false }),
              tom: "amber",
            },
          ].map((chip) => (
            <span key={chip.rotulo}>
              <small>{chip.rotulo}</small>
              <b className={chip.tom}>{chip.valor}</b>
            </span>
          ))}
        </div>
      </header>

      {/* ============================================== faixa de vitais */}
      <section className="panel faixa-vitais">
        <header className="panel-head">
          <span>
            <Activity size={11} /> VITAIS DA MÁQUINA
          </span>
          <b>
            {maquina?.cpu.model.replace(/\(R\)|\(TM\)|CPU|Processor/g, "").trim() ?? "—"} ·{" "}
            {maquina?.cpu.cores ?? "—"} NÚCLEOS
          </b>
        </header>

        <div className="vitais-corpo">
          <div className="vitais-medidores">
            <Medidor
              valor={maquina?.cpu.usagePercent ?? null}
              rotulo="CPU"
              detalhe={`${((maquina?.cpu.speedMhz ?? 0) / 1000).toFixed(1)} GHz · fila ${maquina?.cpu.queueLength ?? "—"}`}
              icone={<Cpu size={10} />}
            />
            <Medidor
              valor={maquina?.memory.usedPercent ?? null}
              rotulo="MEMÓRIA"
              detalhe={
                maquina
                  ? `${gb(maquina.memory.usedBytes)} de ${gb(maquina.memory.totalBytes)} GB`
                  : "—"
              }
              icone={<MemoryStick size={10} />}
            />
            <Medidor
              valor={maquina?.gpu.usagePercent ?? null}
              rotulo="VÍDEO"
              detalhe={maquina?.gpu.name?.replace(/\(R\)|\(TM\)/g, "").trim().slice(0, 22) ?? "—"}
              icone={<MonitorCog size={10} />}
            />
            <Medidor
              valor={discoPrincipal?.usedPercent ?? null}
              rotulo={discoPrincipal ? `DISCO ${discoPrincipal.name}` : "DISCO"}
              detalhe={discoPrincipal ? `${gb(discoPrincipal.freeBytes)} GB livres` : "—"}
              icone={<HardDrive size={10} />}
            />
          </div>

          <div className="vitais-grafico">
            <AreaMultipla
              series={[
                { rotulo: "CPU", valores: historicoCpu, classe: "s-cpu" },
                { rotulo: "MEM", valores: historicoMem, classe: "s-mem" },
                { rotulo: "GPU", valores: historicoGpu, classe: "s-gpu" },
                { rotulo: "E/S", valores: historicoIo, classe: "s-io" },
              ]}
            />
            <div className="io-row">
              <article>
                <small>LEITURA</small>
                <b className="mint">{taxaBytes(maquina?.diskIo.readPerSecond ?? null)}</b>
              </article>
              <article>
                <small>ESCRITA</small>
                <b className="amber">{taxaBytes(maquina?.diskIo.writePerSecond ?? null)}</b>
              </article>
              <article>
                <small>REDE ↓</small>
                <b className="cyan">
                  {taxaBytes(
                    (maquina?.network ?? []).reduce((soma, rede) => soma + (rede.rxPerSecond ?? 0), 0) ||
                      null
                  )}
                </b>
              </article>
              <article>
                <small>TROCAS/s</small>
                <b className="muted">{compacto(maquina?.cpu.contextSwitchesPerSecond ?? null)}</b>
              </article>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================== o mundo lá fora */}
      <div className="board-linha linha-mundo">
        <section className="panel">
          <header className="panel-head">
            <span>
              <CloudSun size={11} /> TEMPO
            </span>
            <b>{clima?.local ?? "—"}</b>
          </header>

          {clima && clima.temperatura !== null ? (
            <>
              <div className="clima-agora">
                <strong>
                  {Math.round(clima.temperatura)}
                  <span>°C</span>
                </strong>
                <div>
                  <p>{clima.descricao ?? "—"}</p>
                  <small>
                    sensação {clima.sensacao !== null ? `${Math.round(clima.sensacao)}°` : "—"} ·
                    umidade {clima.umidade ?? "—"}% · vento{" "}
                    {clima.vento !== null ? `${Math.round(clima.vento)} km/h` : "—"}
                  </small>
                </div>
              </div>
              <div className="clima-dias">
                {clima.dias.slice(0, 5).map((dia) => (
                  <article key={dia.data}>
                    <small>{diaDaSemana(dia.data)}</small>
                    <b>{Math.round(dia.maxima)}°</b>
                    <em>{Math.round(dia.minima)}°</em>
                    <i className={dia.chuva >= 50 ? "alert" : dia.chuva >= 20 ? "amber" : "muted"}>
                      {Math.round(dia.chuva)}%
                    </i>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <p className="vazio">{mundoFalhou ? "sem rede para consultar" : "consultando…"}</p>
          )}
        </section>

        <section className="panel">
          <header className="panel-head">
            <span>
              <TrendingUp size={11} /> MERCADO
            </span>
            <b>{mundo ? haQuantoTempo(mundo.medidoEm) : "—"}</b>
          </header>
          <div className="cotacoes">
            {(mundo?.cotacoes ?? []).map((cotacao) => {
              const subiu = cotacao.variacaoPercentual >= 0;
              // A faixa do dia dá contexto que o número sozinho não dá: saber se
              // o valor atual está no topo ou no fundo do que já andou hoje.
              const amplitude = Math.max(1e-9, cotacao.maximo - cotacao.minimo);
              const posicao = Math.min(
                100,
                Math.max(0, ((cotacao.valor - cotacao.minimo) / amplitude) * 100)
              );
              return (
                <article key={cotacao.par}>
                  <header>
                    <span>{cotacao.nome}</span>
                    <b>
                      {cotacao.valor.toLocaleString("pt-BR", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </b>
                    <em className={subiu ? "mint" : "alert"}>
                      {subiu ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                      {cotacao.variacaoPercentual.toFixed(2)}%
                    </em>
                  </header>
                  <div className="faixa-dia">
                    <i style={{ left: `${posicao}%` }} className={subiu ? "mint" : "alert"} />
                  </div>
                  <footer>
                    <small>{cotacao.minimo.toFixed(2)}</small>
                    <small>{cotacao.maximo.toFixed(2)}</small>
                  </footer>
                </article>
              );
            })}
            {!mundo?.cotacoes.length ? (
              <p className="vazio">{mundoFalhou ? "sem rede" : "consultando…"}</p>
            ) : null}
          </div>
        </section>

        <section className="panel">
          <header className="panel-head">
            <span>
              <Newspaper size={11} /> MANCHETES
            </span>
            <b>{mundo?.manchetes.length ?? 0}</b>
          </header>
          <div className="manchetes">
            {(mundo?.manchetes ?? []).slice(0, 7).map((manchete) => (
              <a
                key={manchete.link}
                href={manchete.link}
                target="_blank"
                rel="noreferrer noopener"
                title={manchete.titulo}
              >
                <span>{manchete.titulo}</span>
                <small>{haQuantoTempo(manchete.quando)}</small>
              </a>
            ))}
            {!mundo?.manchetes.length ? (
              <p className="vazio">{mundoFalhou ? "sem rede" : "consultando…"}</p>
            ) : null}
          </div>
        </section>
      </div>

      {/* ============================================== vida de dev */}
      <div className="board-linha linha-dev">
        <section className="panel">
          <header className="panel-head">
            <span>
              <GitBranch size={11} /> EM MOVIMENTO
            </span>
            <b>
              {repositorios.filter((repo) => repo.alterados + repo.naoRastreados > 0).length} COM
              PENDÊNCIA
              {repositorios.length > MAX_REPOS ? ` · DE ${repositorios.length}` : ""}
            </b>
          </header>
          <div className="repos">
            {reposEmMovimento.map((repo) => {
              const sujo = repo.alterados + repo.naoRastreados > 0;
              return (
                <article key={repo.caminho} title={repo.caminho}>
                  <div className="repo-topo">
                    <strong className={sujo ? "amber" : "mint"}>{repo.nome}</strong>
                    <span className="repo-ramo">{repo.ramo ?? "—"}</span>
                    <em>{haQuantoTempo(repo.ultimoCommitEm)}</em>
                  </div>
                  <p>{repo.ultimoCommit ?? "sem commits"}</p>
                  <div className="repo-marcas">
                    {repo.alterados > 0 ? <i className="amber">{repo.alterados} alterado(s)</i> : null}
                    {repo.naoRastreados > 0 ? (
                      <i className="muted">{repo.naoRastreados} novo(s)</i>
                    ) : null}
                    {repo.aFrente > 0 ? <i className="cyan">↑{repo.aFrente}</i> : null}
                    {repo.atras > 0 ? <i className="alert">↓{repo.atras}</i> : null}
                    {!sujo && repo.aFrente === 0 && repo.atras === 0 ? (
                      <i className="mint">limpo</i>
                    ) : null}
                  </div>
                </article>
              );
            })}
            {!repositorios.length ? <p className="vazio">procurando repositórios…</p> : null}
          </div>

          {/*
            As portas viraram uma faixa aqui embaixo, e não mais uma seção.
            Sozinhas ocupavam uma coluna inteira para meia dúzia de linhas, e
            ficavam vazias ao lado da lista de repositórios. Aqui elas respondem
            à pergunta vizinha da lista: qual destes projetos está no ar agora.
          */}
          <footer className="portas-faixa">
            <small>
              <Plug size={10} /> ESCUTANDO
            </small>
            <div>
              {(dev?.portas ?? []).map((porta) => (
                <i key={porta.porta} title={porta.processo ?? undefined}>
                  <b>{porta.porta}</b>
                  {porta.processo ? <span>{porta.processo}</span> : null}
                </i>
              ))}
              {!dev?.portas.length ? <em>nada no ar</em> : null}
            </div>
          </footer>
        </section>

        <section className="panel">
          <header className="panel-head">
            <span>
              <FileClock size={11} /> MEXIDOS RECENTEMENTE
            </span>
            <b>{dev ? haQuantoTempo(dev.medidoEm) : "—"}</b>
          </header>
          <div className="arquivos">
            {(dev?.arquivos ?? []).slice(0, 9).map((arquivo) => (
              <article key={arquivo.caminho} title={arquivo.caminho}>
                <span>{arquivo.nome}</span>
                <em>{tamanho(arquivo.tamanhoBytes)}</em>
                <small>{haQuantoTempo(arquivo.modificadoEm)}</small>
              </article>
            ))}
            {!dev?.arquivos.length ? <p className="vazio">nenhum arquivo recente</p> : null}
          </div>
        </section>
      </div>

      {/* ============================================== território do Jarvis */}
      <div className="board-linha linha-jarvis">
        <section className="panel">
          <header className="panel-head">
            <span>
              <Sparkles size={11} /> DEIXADO PELO JARVIS
            </span>
            <b>{cartoes?.length ? `${cartoes.length} CARTÃO(ÕES)` : "LIVRE"}</b>
          </header>
          <div className="cartoes">
            {(cartoes ?? []).map((cartao) => (
              <article key={cartao.id} className={`cartao tom-${cartao.tom}`}>
                <header>
                  <strong>{cartao.titulo}</strong>
                  <em>{haQuantoTempo(cartao.criadoEm)}</em>
                  <button
                    type="button"
                    onClick={() => removerCartao.mutate({ id: cartao.id })}
                    aria-label={`Remover ${cartao.titulo}`}
                  >
                    <Trash2 size={11} />
                  </button>
                </header>
                <ul>
                  {cartao.itens.map((item, indice) => (
                    <li key={indice}>
                      {item.rotulo ? <b>{item.rotulo}</b> : null}
                      <span>{item.texto}</span>
                    </li>
                  ))}
                </ul>
                {cartao.nota ? <footer>{cartao.nota}</footer> : null}
              </article>
            ))}
            {!cartoes?.length ? (
              <p className="vazio">
                peça ao Jarvis para deixar algo aqui — uma comparação, um resumo, um lembrete
              </p>
            ) : null}
          </div>
        </section>

        <section className="panel">
          <header className="panel-head">
            <span>
              <BrainCircuit size={11} /> O QUE ELE APRENDEU
            </span>
            <b>
              {quantasEsquecidas > 0 ? (
                <button
                  type="button"
                  className="alternar"
                  onClick={() => setMostrarEsquecidas((atual) => !atual)}
                >
                  {mostrarEsquecidas ? "ocultar" : `ver ${quantasEsquecidas} apagada(s)`}
                </button>
              ) : (
                `${visiveis.length} MEMÓRIA(S)`
              )}
            </b>
          </header>
          <div className="memorias">
            {visiveis.map((memoria) => (
              <article key={memoria.id} className={memoria.esquecida ? "apagada" : ""}>
                <div className="memoria-texto">
                  <span>{memoria.conteudo}</span>
                  <div className="memoria-marcas">
                    <i className={`tipo-${memoria.tipo}`}>{memoria.tipo}</i>
                    {memoria.fixada ? <i className="cyan">fixada</i> : null}
                    {memoria.origem === "inferida" ? <i className="muted">deduzida</i> : null}
                    {memoria.versao > 1 ? <i className="muted">v{memoria.versao}</i> : null}
                    {memoria.usos > 0 ? <i className="muted">usada {memoria.usos}×</i> : null}
                    <i className="muted">{haQuantoTempo(memoria.atualizadaEm)}</i>
                  </div>
                </div>
                {memoria.esquecida ? (
                  <button
                    type="button"
                    onClick={() => restaurarMemoria.mutate({ id: memoria.id })}
                    aria-label="Restaurar memória"
                    title="Restaurar"
                  >
                    <Undo2 size={11} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => esquecerMemoria.mutate({ id: memoria.id })}
                    aria-label="Fazer o Jarvis esquecer"
                    title="Esquecer"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </article>
            ))}
            {!visiveis.length ? (
              <p className="vazio">ele ainda não guardou nada sobre você</p>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
