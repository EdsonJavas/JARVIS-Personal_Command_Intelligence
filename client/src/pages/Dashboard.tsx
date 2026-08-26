// Painel — a segunda janela do Jarvis, pensada para tela grande.
//
// Sem cartões, sem molduras, sem seção dentro de seção: um fundo só, e a
// informação organizada por proximidade e por fio de cabelo. O centro é DELE —
// o que o Jarvis deixou ocupa a maior área, porque é a única parte da tela que
// nasce de um pedido do dono. A máquina fica numa coluna à esquerda, em barras
// que se leem de relance; o mundo e o que ele aprendeu, à direita.
//
// O que entra passou por um filtro: serve para decidir alguma coisa. Contagem
// de processos e trocas de contexto por segundo não passaram.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ExternalLink,
  Minus,
  Pin,
  PinOff,
  Trash2,
  Undo2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { LOGIN_PATH } from "@/const";
import type { ItemDoCartao } from "@shared/painel";

const POLL_MAQUINA_MS = 2000;
const POLL_MUNDO_MS = 5 * 60 * 1000;
const POLL_DEV_MS = 60 * 1000;
/** Os cartões chegam por pedido do dono ao Jarvis: precisam aparecer rápido. */
const POLL_CARTOES_MS = 3000;
/** Enquanto o coletor do servidor ainda não tem o dado, insiste rápido. */
const POLL_AQUECENDO_MS = 3000;
const HISTORICO = 120;
const MAX_REPOS = 6;

/* --------------------------------- formato --------------------------------- */

const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);

function taxa(valor: number | null) {
  if (valor === null) return "—";
  if (valor >= 1024 ** 2) return `${(valor / 1024 ** 2).toFixed(1)} MB/s`;
  if (valor >= 1024) return `${(valor / 1024).toFixed(0)} KB/s`;
  return `${valor.toFixed(0)} B/s`;
}

function tamanho(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function atividade(segundos: number) {
  const dias = Math.floor(segundos / 86400);
  const horas = Math.floor((segundos % 86400) / 3600);
  const minutos = Math.floor((segundos % 3600) / 60);
  if (dias > 0) return `${dias}d ${horas}h`;
  if (horas > 0) return `${horas}h ${minutos}min`;
  return `${minutos}min`;
}

function haQuantoTempo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d} d` : `${Math.floor(d / 30)} mês`;
}

function diaDaSemana(data: string) {
  return new Date(`${data}T12:00:00`)
    .toLocaleDateString("pt-BR", { weekday: "short" })
    .replace(".", "")
    .slice(0, 3);
}

/** Tom por pressão: só o que passa de 85 pede atenção de verdade. */
const tomDePercentual = (p: number | null) =>
  p === null ? "" : p >= 90 ? "pl-alerta" : p >= 75 ? "pl-atencao" : "";

/* ------------------------------ peças de leitura ---------------------------- */

function Barra({
  rotulo,
  valor,
  detalhe,
}: {
  rotulo: string;
  valor: number | null;
  detalhe: string;
}) {
  return (
    <div className={`pl-barra ${tomDePercentual(valor)}`}>
      <div className="pl-barra-topo">
        <span>{rotulo}</span>
        <b>{valor === null ? "—" : `${Math.round(valor)}%`}</b>
      </div>
      <div className="pl-barra-trilho">
        <i style={{ width: `${Math.max(0, Math.min(100, valor ?? 0))}%` }} />
      </div>
      <small>{detalhe}</small>
    </div>
  );
}

function Historico({ series }: { series: { rotulo: string; valores: number[]; classe: string }[] }) {
  const largura = 300;
  const altura = 54;
  const caminho = (valores: number[]) => {
    if (valores.length < 2) return "";
    return valores
      .map((v, i) => {
        const x = ((i / (HISTORICO - 1)) * largura).toFixed(1);
        const y = (altura - (Math.max(0, Math.min(100, v)) / 100) * altura).toFixed(1);
        return `${i === 0 ? "M" : "L"}${x},${y}`;
      })
      .join(" ");
  };
  return (
    <div className="pl-historico">
      <svg viewBox={`0 0 ${largura} ${altura}`} preserveAspectRatio="none">
        {series.map((s) => (
          <path key={s.rotulo} d={caminho(s.valores)} className={s.classe} />
        ))}
      </svg>
      <div className="pl-legenda">
        {series.map((s) => (
          <span key={s.rotulo} className={s.classe}>
            {s.rotulo}
          </span>
        ))}
      </div>
    </div>
  );
}

function Titulo({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <h2 className="pl-titulo">
      <span>{children}</span>
      {extra ? <em>{extra}</em> : null}
    </h2>
  );
}

/* ------------------------------ itens do Jarvis ----------------------------- */

type Item = ItemDoCartao;

function Tendencia({ valor }: { valor?: "sobe" | "desce" | "estavel" }) {
  if (valor === "sobe") return <ArrowUpRight size={12} className="pl-mint" />;
  if (valor === "desce") return <ArrowDownRight size={12} className="pl-alert" />;
  if (valor === "estavel") return <Minus size={12} className="pl-muted" />;
  return null;
}

function ItemDoCartao({
  item,
  indice,
  aoMarcarPasso,
}: {
  item: Item;
  indice: number;
  aoMarcarPasso: (indice: number, feito: boolean) => void;
}) {
  switch (item.tipo) {
    case "metrica":
      return (
        <div className={`pl-item pl-metrica ${item.tom ? `tom-${item.tom}` : ""}`}>
          <small>{item.rotulo}</small>
          <b>
            {item.valor}
            {item.unidade ? <span>{item.unidade}</span> : null}
            <Tendencia valor={item.tendencia} />
          </b>
        </div>
      );
    case "progresso":
      return (
        <div className="pl-item pl-progresso">
          <div>
            <span>{item.rotulo}</span>
            <b>{item.valor}%</b>
          </div>
          <div className="pl-barra-trilho">
            <i style={{ width: `${item.valor}%` }} />
          </div>
          {item.texto ? <small>{item.texto}</small> : null}
        </div>
      );
    case "link":
      return (
        <a className="pl-item pl-link" href={item.url} target="_blank" rel="noreferrer noopener">
          {item.rotulo ? <small>{item.rotulo}</small> : null}
          <span>
            {item.texto} <ExternalLink size={11} />
          </span>
        </a>
      );
    case "lista":
      return (
        <div className="pl-item pl-lista">
          {item.rotulo ? <small>{item.rotulo}</small> : null}
          <ul>
            {item.itens.map((linha, i) => (
              <li key={i}>{linha}</li>
            ))}
          </ul>
        </div>
      );
    case "passo":
      return (
        <button
          type="button"
          className={`pl-item pl-passo ${item.feito ? "feito" : ""}`}
          onClick={() => aoMarcarPasso(indice, !item.feito)}
        >
          <i>{item.feito ? <Check size={11} /> : null}</i>
          <span>{item.texto}</span>
        </button>
      );
    case "tabela":
      return (
        <div className="pl-item pl-tabela">
          <table>
            <thead>
              <tr>
                {item.colunas.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {item.linhas.map((linha, i) => (
                <tr key={i}>
                  {linha.map((celula, j) => (
                    <td key={j}>{celula}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "codigo":
      return (
        <pre className="pl-item pl-codigo" data-linguagem={item.linguagem ?? ""}>
          {item.texto}
        </pre>
      );
    case "separador":
      return (
        <div className="pl-item pl-separador">{item.rotulo ? <span>{item.rotulo}</span> : null}</div>
      );
    default:
      return (
        <p className="pl-item pl-texto">
          {item.rotulo ? <small>{item.rotulo}</small> : null}
          <span>{item.texto}</span>
        </p>
      );
  }
}

/* ---------------------------------- painel ---------------------------------- */

export default function Dashboard() {
  const { user, loading } = useAuth({ redirectOnUnauthenticated: true, redirectPath: LOGIN_PATH });
  const utils = trpc.useUtils();

  const { data: maquina } = trpc.machine.stats.useQuery(undefined, {
    refetchInterval: POLL_MAQUINA_MS,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const { data: mundo, isError: mundoFalhou } = trpc.board.world.useQuery(undefined, {
    refetchInterval: (q) => {
      const d = q.state.data;
      return !d || (d.clima.temperatura === null && d.cotacoes.length === 0)
        ? POLL_AQUECENDO_MS
        : POLL_MUNDO_MS;
    },
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const { data: dev } = trpc.board.dev.useQuery(undefined, {
    refetchInterval: (q) => {
      const d = q.state.data;
      return !d || (d.repositorios.length === 0 && d.portas.length === 0)
        ? POLL_AQUECENDO_MS
        : POLL_DEV_MS;
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

  const invalidarCartoes = { onSuccess: () => utils.board.cards.invalidate() };
  const removerCartao = trpc.board.removeCard.useMutation(invalidarCartoes);
  const atualizarCartao = trpc.board.updateCard.useMutation(invalidarCartoes);
  const invalidarMemorias = { onSuccess: () => utils.memoria.listar.invalidate() };
  const esquecer = trpc.memoria.esquecer.useMutation(invalidarMemorias);
  const restaurar = trpc.memoria.restaurar.useMutation(invalidarMemorias);

  const [hCpu, setHCpu] = useState<number[]>([]);
  const [hMem, setHMem] = useState<number[]>([]);
  const [hGpu, setHGpu] = useState<number[]>([]);
  const [relogio, setRelogio] = useState(() => new Date());
  const [mostrarEsquecidas, setMostrarEsquecidas] = useState(false);
  const ultimaMarcaRef = useRef<string | null>(null);

  useEffect(() => {
    const t = window.setInterval(() => setRelogio(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!maquina || maquina.measuredAt === ultimaMarcaRef.current) return;
    ultimaMarcaRef.current = maquina.measuredAt;
    const empurrar = (definir: (fn: (a: number[]) => number[]) => void, v: number) =>
      definir((a) => [...a, v].slice(-HISTORICO));
    if (maquina.cpu.usagePercent !== null) empurrar(setHCpu, maquina.cpu.usagePercent);
    empurrar(setHMem, maquina.memory.usedPercent);
    if (maquina.gpu.usagePercent !== null) empurrar(setHGpu, maquina.gpu.usagePercent);
  }, [maquina]);

  const disco = useMemo(() => {
    const discos = maquina?.disks ?? [];
    return discos.find((d) => d.name.startsWith("C")) ?? discos[0] ?? null;
  }, [maquina]);

  const repos = useMemo(() => {
    const todos = dev?.repositorios ?? [];
    const pendencia = (r: (typeof todos)[number]) => r.alterados + r.naoRastreados + r.aFrente + r.atras;
    return [...todos]
      .sort((a, b) => pendencia(b) - pendencia(a) || (b.ultimoCommitEm ?? "").localeCompare(a.ultimoCommitEm ?? ""))
      .slice(0, MAX_REPOS);
  }, [dev]);

  const memoriasVisiveis = useMemo(
    () => (memorias ?? []).filter((m) => mostrarEsquecidas || !m.esquecida),
    [memorias, mostrarEsquecidas]
  );
  const esquecidas = (memorias ?? []).filter((m) => m.esquecida).length;

  if (loading || !user) {
    return (
      <main className="painel">
        <div className="boot-state">ABRINDO PAINEL…</div>
      </main>
    );
  }

  const clima = mundo?.clima;
  const redeBaixando =
    (maquina?.network ?? []).reduce((s, r) => s + (r.rxPerSecond ?? 0), 0) || null;

  return (
    <main className="painel">
      {/* ------------------------------------------------------------ cabeçalho */}
      <header className="pl-cabecalho">
        <h1>
          JARVIS <i>·</i> PAINEL
        </h1>
        <p>
          {maquina?.host.hostname ?? "—"} · {atividade(maquina?.host.uptimeSeconds ?? 0)} ligado
          {clima?.local ? ` · ${clima.local}` : ""}
        </p>
        <time>
          {relogio.toLocaleTimeString("pt-BR", { hour12: false })}
          <small>{relogio.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}</small>
        </time>
      </header>

      <div className="pl-corpo">
        {/* ------------------------------------------------------------ máquina */}
        <aside className="pl-coluna pl-maquina">
          <Titulo
            extra={`${maquina?.cpu.model.replace(/\(R\)|\(TM\)|CPU|Processor/g, "").trim().slice(0, 28) ?? "—"}`}
          >
            MÁQUINA
          </Titulo>

          <Barra
            rotulo="CPU"
            valor={maquina?.cpu.usagePercent ?? null}
            detalhe={`${((maquina?.cpu.speedMhz ?? 0) / 1000).toFixed(1)} GHz · ${maquina?.cpu.cores ?? "—"} núcleos`}
          />
          <Barra
            rotulo="MEMÓRIA"
            valor={maquina?.memory.usedPercent ?? null}
            detalhe={maquina ? `${gb(maquina.memory.usedBytes)} de ${gb(maquina.memory.totalBytes)} GB` : "—"}
          />
          <Barra
            rotulo="VÍDEO"
            valor={maquina?.gpu.usagePercent ?? null}
            detalhe={maquina?.gpu.name?.replace(/\(R\)|\(TM\)/g, "").trim().slice(0, 30) ?? "—"}
          />
          <Barra
            rotulo={disco ? `DISCO ${disco.name}` : "DISCO"}
            valor={disco?.usedPercent ?? null}
            detalhe={disco ? `${gb(disco.freeBytes)} GB livres` : "—"}
          />

          <Historico
            series={[
              { rotulo: "cpu", valores: hCpu, classe: "s-cpu" },
              { rotulo: "mem", valores: hMem, classe: "s-mem" },
              { rotulo: "gpu", valores: hGpu, classe: "s-gpu" },
            ]}
          />

          <dl className="pl-leituras">
            <div>
              <dt>leitura</dt>
              <dd>{taxa(maquina?.diskIo.readPerSecond ?? null)}</dd>
            </div>
            <div>
              <dt>escrita</dt>
              <dd>{taxa(maquina?.diskIo.writePerSecond ?? null)}</dd>
            </div>
            <div>
              <dt>rede ↓</dt>
              <dd>{taxa(redeBaixando)}</dd>
            </div>
            <div>
              <dt>energia</dt>
              <dd className={maquina?.battery && !maquina.battery.charging && maquina.battery.percent < 25 ? "pl-alert" : ""}>
                {maquina?.battery ? `${maquina.battery.percent}%${maquina.battery.charging ? " ⚡" : ""}` : "tomada"}
              </dd>
            </div>
          </dl>

          <Titulo
            extra={`${(dev?.repositorios ?? []).filter((r) => r.alterados + r.naoRastreados > 0).length} com pendência`}
          >
            EM MOVIMENTO
          </Titulo>
          <div className="pl-repos">
            {repos.map((repo) => {
              const sujo = repo.alterados + repo.naoRastreados > 0;
              return (
                <article key={repo.caminho} title={repo.caminho}>
                  <div>
                    <strong className={sujo ? "pl-atencao-texto" : ""}>{repo.nome}</strong>
                    <span>{repo.ramo ?? "—"}</span>
                    <em>{haQuantoTempo(repo.ultimoCommitEm)}</em>
                  </div>
                  <p>{repo.ultimoCommit ?? "sem commits"}</p>
                  <small>
                    {repo.alterados > 0 ? `${repo.alterados} alterado(s) ` : ""}
                    {repo.naoRastreados > 0 ? `${repo.naoRastreados} novo(s) ` : ""}
                    {repo.aFrente > 0 ? `↑${repo.aFrente} ` : ""}
                    {repo.atras > 0 ? `↓${repo.atras} ` : ""}
                    {!sujo && repo.aFrente === 0 && repo.atras === 0 ? "limpo" : ""}
                  </small>
                </article>
              );
            })}
            {!repos.length ? <p className="pl-vazio">procurando repositórios…</p> : null}
          </div>

          <div className="pl-portas">
            <span>no ar</span>
            {(dev?.portas ?? []).map((p) => (
              <i key={p.porta} title={p.processo ?? undefined}>
                {p.porta}
                {p.processo ? <small>{p.processo}</small> : null}
              </i>
            ))}
            {!dev?.portas.length ? <em>nada</em> : null}
          </div>

          <Titulo extra={dev ? haQuantoTempo(dev.medidoEm) : "—"}>MEXIDOS</Titulo>
          <div className="pl-arquivos">
            {(dev?.arquivos ?? []).slice(0, 8).map((a) => (
              <div key={a.caminho} title={a.caminho}>
                <span>{a.nome}</span>
                <em>{tamanho(a.tamanhoBytes)}</em>
                <small>{haQuantoTempo(a.modificadoEm)}</small>
              </div>
            ))}
          </div>
        </aside>

        {/* ------------------------------------------------------------ o dele */}
        <section className="pl-jarvis">
          <Titulo extra={cartoes?.length ? `${cartoes.length}` : "livre"}>DEIXADO PELO JARVIS</Titulo>

          <div className="pl-cartoes">
            {(cartoes ?? []).map((cartao) => (
              <article
                key={cartao.id}
                className={`pl-cartao tom-${cartao.tom} ${cartao.largura === "largo" ? "largo" : ""} ${cartao.fixado ? "fixado" : ""}`}
              >
                <header>
                  <div>
                    <strong>{cartao.titulo}</strong>
                    {cartao.subtitulo ? <span>{cartao.subtitulo}</span> : null}
                  </div>
                  <em>{haQuantoTempo(cartao.criadoEm)}</em>
                  <button
                    type="button"
                    onClick={() => atualizarCartao.mutate({ id: cartao.id, fixado: !cartao.fixado })}
                    aria-label={cartao.fixado ? "Soltar" : "Fixar"}
                    title={cartao.fixado ? "Soltar" : "Fixar"}
                  >
                    {cartao.fixado ? <PinOff size={11} /> : <Pin size={11} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => removerCartao.mutate({ id: cartao.id })}
                    aria-label={`Remover ${cartao.titulo}`}
                    title="Remover"
                  >
                    <Trash2 size={11} />
                  </button>
                </header>
                <div className="pl-itens">
                  {cartao.itens.map((item, indice) => (
                    <ItemDoCartao
                      key={indice}
                      item={item}
                      indice={indice}
                      aoMarcarPasso={(i, feito) =>
                        atualizarCartao.mutate({ id: cartao.id, passo: { indice: i, feito } })
                      }
                    />
                  ))}
                </div>
                {cartao.nota ? <footer>{cartao.nota}</footer> : null}
              </article>
            ))}
            {!cartoes?.length ? (
              <p className="pl-vazio pl-vazio-grande">
                Nada aqui ainda. Peça uma pesquisa, uma comparação, um plano — o que ele apurar fica
                nesta área.
              </p>
            ) : null}
          </div>
        </section>

        {/* ------------------------------------------------------------ mundo e memória */}
        <aside className="pl-coluna pl-mundo">
          <Titulo extra={clima?.local ?? "—"}>TEMPO</Titulo>
          {clima && clima.temperatura !== null ? (
            <div className="pl-clima">
              <strong>
                {Math.round(clima.temperatura)}
                <span>°</span>
              </strong>
              <div>
                <p>{clima.descricao ?? "—"}</p>
                <small>
                  sensação {clima.sensacao !== null ? `${Math.round(clima.sensacao)}°` : "—"} · umidade{" "}
                  {clima.umidade ?? "—"}% · vento {clima.vento !== null ? `${Math.round(clima.vento)} km/h` : "—"}
                </small>
              </div>
              <ol>
                {clima.dias.slice(0, 5).map((dia) => (
                  <li key={dia.data}>
                    <small>{diaDaSemana(dia.data)}</small>
                    <b>{Math.round(dia.maxima)}°</b>
                    <em>{Math.round(dia.minima)}°</em>
                    <i className={dia.chuva >= 50 ? "pl-alert" : dia.chuva >= 20 ? "pl-atencao-texto" : ""}>
                      {Math.round(dia.chuva)}%
                    </i>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <p className="pl-vazio">{mundoFalhou ? "sem rede" : "consultando…"}</p>
          )}

          <Titulo extra={mundo ? haQuantoTempo(mundo.medidoEm) : "—"}>MERCADO</Titulo>
          <div className="pl-cotacoes">
            {(mundo?.cotacoes ?? []).map((c) => {
              const subiu = c.variacaoPercentual >= 0;
              return (
                <div key={c.par}>
                  <span>{c.nome}</span>
                  <b>{c.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b>
                  <em className={subiu ? "pl-mint" : "pl-alert"}>
                    {subiu ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                    {Math.abs(c.variacaoPercentual).toFixed(2)}%
                  </em>
                </div>
              );
            })}
            {!mundo?.cotacoes.length ? <p className="pl-vazio">{mundoFalhou ? "sem rede" : "consultando…"}</p> : null}
          </div>

          <Titulo extra={String(mundo?.manchetes.length ?? 0)}>MANCHETES</Titulo>
          <div className="pl-manchetes">
            {(mundo?.manchetes ?? []).slice(0, 6).map((m) => (
              <a key={m.link} href={m.link} target="_blank" rel="noreferrer noopener" title={m.titulo}>
                <span>{m.titulo}</span>
                <small>{haQuantoTempo(m.quando)}</small>
              </a>
            ))}
          </div>

          <Titulo
            extra={
              esquecidas > 0 ? (
                <button type="button" className="pl-alternar" onClick={() => setMostrarEsquecidas((a) => !a)}>
                  {mostrarEsquecidas ? "ocultar" : `${esquecidas} apagada(s)`}
                </button>
              ) : (
                `${memoriasVisiveis.length}`
              )
            }
          >
            O QUE ELE APRENDEU
          </Titulo>
          <div className="pl-memorias">
            {memoriasVisiveis.map((m) => (
              <article key={m.id} className={m.esquecida ? "apagada" : ""}>
                <div>
                  <span>{m.conteudo}</span>
                  <small>
                    {m.tipo}
                    {m.fixada ? " · fixada" : ""}
                    {m.origem === "inferida" ? " · deduzida" : ""}
                    {m.usos > 0 ? ` · usada ${m.usos}×` : ""} · {haQuantoTempo(m.atualizadaEm)}
                  </small>
                </div>
                {m.esquecida ? (
                  <button type="button" onClick={() => restaurar.mutate({ id: m.id })} aria-label="Restaurar" title="Restaurar">
                    <Undo2 size={11} />
                  </button>
                ) : (
                  <button type="button" onClick={() => esquecer.mutate({ id: m.id })} aria-label="Esquecer" title="Esquecer">
                    <Trash2 size={11} />
                  </button>
                )}
              </article>
            ))}
            {!memoriasVisiveis.length ? <p className="pl-vazio">ele ainda não guardou nada</p> : null}
          </div>
        </aside>
      </div>
    </main>
  );
}
