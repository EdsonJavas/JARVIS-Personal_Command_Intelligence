// A MESA do Jarvis — segunda janela, para tela grande.
//
// Nada que a janela principal já mostra: sem máquina, relógio, clima nem
// cotação. Quatro perguntas, quatro lugares. Ele está fazendo algo? — a faixa
// no topo, respondível dali. O que me deixou? — o centro, um documento
// contínuo que nunca perde nada sozinho. O que vai fazer, fez e sabe? — a
// direita. Onde está meu trabalho? — a esquerda.
//
// Sem cards. Espaço, fio de cabelo e tipografia separam as coisas.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { LOGIN_PATH } from "@/const";
import type { Cartao, ItemDoCartao } from "@shared/painel";

const POLL_CARTOES_MS = 3000;
const POLL_DEV_MS = 60 * 1000;
const POLL_AQUECENDO_MS = 3000;
const POLL_EXECUCAO_MS = 2000;
const POLL_ESTADO_MS = 15 * 1000;
const POLL_COMPROMISSOS_MS = 30 * 1000;
const POLL_ACOES_MS = 5000;
const POLL_MEMORIAS_MS = 15 * 1000;
const GRUPOS_DE_FEZ = 10;

/* --------------------------------- formato --------------------------------- */

function haQuantoTempo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d < 30 ? `há ${d} d` : `há ${Math.floor(d / 30)} mês`;
}

function emQuanto(iso: string | null): string {
  if (!iso) return "";
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "agora";
  const min = Math.round(diff / 60000);
  if (min < 60) return `em ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `em ${h} h`;
  return `em ${Math.floor(h / 24)} d`;
}

function horaCurta(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function diaHora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { weekday: "short", hour: "2-digit", minute: "2-digit" }).replace(".", "");
}

function minutosParaHora(min: number | null) {
  if (min === null) return "";
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
function diasDaSemana(texto: string | null) {
  if (!texto) return "todo dia";
  const dias = texto.split(",").map(Number).filter((n) => n >= 0 && n <= 6);
  if (dias.length === 0 || dias.length === 7) return "todo dia";
  const semana = [1, 2, 3, 4, 5];
  if (semana.every((d) => dias.includes(d)) && dias.length === 5) return "seg–sex";
  return dias.map((d) => DIAS[d]).join(" ");
}

function tamanho(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/** Ações destrutivas em dois cliques: o primeiro só pergunta. */
function useConfirmacao() {
  const [pendente, setPendente] = useState<string | null>(null);
  useEffect(() => {
    if (!pendente) return;
    const t = window.setTimeout(() => setPendente(null), 4000);
    return () => window.clearTimeout(t);
  }, [pendente]);
  return {
    armada: (chave: string) => pendente === chave,
    pedir: (chave: string, executar: () => void) => {
      if (pendente === chave) {
        setPendente(null);
        executar();
      } else setPendente(chave);
    },
  };
}

function Bloco({ titulo, extra, children, className = "" }: { titulo: string; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <h2 className="mesa-bloco-titulo">
        <span>{titulo}</span>
        {extra ? <em>{extra}</em> : null}
      </h2>
      {children}
    </section>
  );
}

/* ------------------------------ itens do documento ------------------------- */

function Item({ item, indice, aoMarcar }: { item: ItemDoCartao; indice: number; aoMarcar: (i: number, feito: boolean) => void }) {
  switch (item.tipo) {
    case "metrica":
      return (
        <div className={`it-metrica ${item.tom ? `tom-${item.tom}` : ""}`}>
          <small className="rotulo">{item.rotulo}</small>
          <b>
            {item.valor}
            {item.unidade ? <span>{item.unidade}</span> : null}
            {item.tendencia ? <i>{item.tendencia === "sobe" ? "↑" : item.tendencia === "desce" ? "↓" : "→"}</i> : null}
          </b>
        </div>
      );
    case "progresso":
      return (
        <div className="it-progresso">
          <div>
            <span>{item.rotulo}</span>
            <b>{item.valor}%</b>
          </div>
          <div className="trilho">
            <i style={{ width: `${item.valor}%` }} />
          </div>
          {item.texto ? <p>{item.texto}</p> : null}
        </div>
      );
    case "link":
      return (
        <a className="it-link" href={item.url} target="_blank" rel="noreferrer noopener">
          {item.rotulo ? <small className="rotulo">{item.rotulo}</small> : null}
          <span>{item.texto} ↗</span>
        </a>
      );
    case "lista":
      return (
        <div className="it-lista">
          {item.rotulo ? <small className="rotulo">{item.rotulo}</small> : null}
          <ul>
            {item.itens.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      );
    case "passo":
      return (
        <button type="button" className={`it-passo ${item.feito ? "feito" : ""}`} onClick={() => aoMarcar(indice, !item.feito)}>
          <i>{item.feito ? "✓" : ""}</i>
          <span>{item.texto}</span>
        </button>
      );
    case "tabela":
      return (
        <div className="it-tabela">
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
      return <pre className="it-codigo">{item.texto}</pre>;
    case "separador":
      return <div className="it-separador">{item.rotulo ? <span>{item.rotulo}</span> : null}</div>;
    default:
      return (
        <p className="it-texto">
          {item.rotulo ? <small className="rotulo">{item.rotulo}</small> : null}
          {item.texto}
        </p>
      );
  }
}

/** Métricas seguidas ficam lado a lado; o resto, em fluxo. */
function Itens({ itens, aoMarcar }: { itens: ItemDoCartao[]; aoMarcar: (i: number, feito: boolean) => void }) {
  const blocos: ReactNode[] = [];
  let i = 0;
  while (i < itens.length) {
    if (itens[i].tipo === "metrica") {
      const grupo: ReactNode[] = [];
      while (i < itens.length && itens[i].tipo === "metrica") {
        grupo.push(<Item key={i} item={itens[i]} indice={i} aoMarcar={aoMarcar} />);
        i += 1;
      }
      blocos.push(
        <div key={`m${i}`} className="it-metricas">
          {grupo}
        </div>
      );
    } else {
      blocos.push(<Item key={i} item={itens[i]} indice={i} aoMarcar={aoMarcar} />);
      i += 1;
    }
  }
  return <div className="mesa-itens">{blocos}</div>;
}

type Filtro = "tudo" | "fixados" | "passos" | "alerta";

function Secao({ cartao, confirmacao, aoFixar, aoRemover, aoMarcar }: {
  cartao: Cartao;
  confirmacao: ReturnType<typeof useConfirmacao>;
  aoFixar: () => void;
  aoRemover: () => void;
  aoMarcar: (i: number, feito: boolean) => void;
}) {
  const passos = cartao.itens.filter((i) => i.tipo === "passo");
  const feitos = passos.filter((i) => i.tipo === "passo" && i.feito).length;
  const chave = `cartao-${cartao.id}`;
  return (
    <article className={`mesa-secao tom-${cartao.tom}`}>
      <header>
        <h3>{cartao.titulo}</h3>
        <span className="meta">
          <span>{haQuantoTempo(cartao.criadoEm)}</span>
          <span>#{cartao.id}</span>
          {passos.length ? <span>{feitos}/{passos.length} passos</span> : null}
        </span>
        <span className="acoes">
          <button type="button" className="acao" onClick={aoFixar}>
            {cartao.fixado ? "soltar" : "fixar"}
          </button>
          <button type="button" className={`acao ${confirmacao.armada(chave) ? "confirmar" : ""}`} onClick={() => confirmacao.pedir(chave, aoRemover)}>
            {confirmacao.armada(chave) ? "confirmar?" : "remover"}
          </button>
        </span>
      </header>
      {cartao.subtitulo ? <p className="sub">{cartao.subtitulo}</p> : null}
      <Itens itens={cartao.itens} aoMarcar={aoMarcar} />
      {cartao.nota ? <footer>{cartao.nota}</footer> : null}
    </article>
  );
}

/* ---------------------------------- a mesa ---------------------------------- */

export default function Dashboard() {
  const { user, loading } = useAuth({ redirectOnUnauthenticated: true, redirectPath: LOGIN_PATH });
  const utils = trpc.useUtils();
  const confirmacao = useConfirmacao();

  const { data: cartoes } = trpc.board.cards.useQuery(undefined, { refetchInterval: POLL_CARTOES_MS, refetchOnWindowFocus: false });
  const { data: dev } = trpc.board.dev.useQuery(undefined, {
    refetchInterval: (q) => (!q.state.data || q.state.data.repositorios.length === 0 ? POLL_AQUECENDO_MS : POLL_DEV_MS),
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const { data: execucao } = trpc.jarvis.execucaoAtiva.useQuery(undefined, { refetchInterval: POLL_EXECUCAO_MS, refetchOnWindowFocus: false, retry: false });
  const { data: estado } = trpc.jarvis.estado.useQuery(undefined, { refetchInterval: POLL_ESTADO_MS, refetchOnWindowFocus: false, retry: 1 });
  const { data: compromissos } = trpc.compromissos.proximos.useQuery(undefined, { refetchInterval: POLL_COMPROMISSOS_MS, refetchOnWindowFocus: false, retry: 1 });
  const { data: acoes } = trpc.jarvis.acoes.useQuery({ limite: 100 }, { refetchInterval: POLL_ACOES_MS, refetchOnWindowFocus: false, retry: 1 });
  const { data: memorias } = trpc.memoria.listar.useQuery(undefined, { refetchInterval: POLL_MEMORIAS_MS, refetchOnWindowFocus: false, retry: 1 });

  const invalidarCartoes = { onSuccess: () => utils.board.cards.invalidate() };
  const removerCartao = trpc.board.removeCard.useMutation(invalidarCartoes);
  const atualizarCartao = trpc.board.updateCard.useMutation(invalidarCartoes);
  const cancelarCompromisso = trpc.compromissos.cancelar.useMutation({ onSuccess: () => utils.compromissos.proximos.invalidate() });
  const invalidarMemorias = { onSuccess: () => utils.memoria.listar.invalidate() };
  const esquecer = trpc.memoria.esquecer.useMutation(invalidarMemorias);
  const restaurar = trpc.memoria.restaurar.useMutation(invalidarMemorias);
  const responder = trpc.jarvis.responder.useMutation({ onSuccess: () => utils.jarvis.execucaoAtiva.invalidate() });
  const interromper = trpc.jarvis.cancelarExecucao.useMutation({ onSuccess: () => utils.jarvis.execucaoAtiva.invalidate() });

  const [filtro, setFiltro] = useState<Filtro>("tudo");
  const [gruposVisiveis, setGruposVisiveis] = useState(GRUPOS_DE_FEZ);
  const [acaoAberta, setAcaoAberta] = useState<number | null>(null);
  const [mostrarApagadas, setMostrarApagadas] = useState(false);
  const [versoesDe, setVersoesDe] = useState<number | null>(null);
  const [respostaTexto, setRespostaTexto] = useState("");
  const [, tique] = useState(0);
  const tiqueRef = useRef(0);
  useEffect(() => {
    const t = window.setInterval(() => tique((tiqueRef.current += 1)), 1000);
    return () => window.clearInterval(t);
  }, []);

  const { data: versoes } = trpc.memoria.historico.useQuery({ id: versoesDe ?? 0 }, { enabled: versoesDe !== null, refetchOnWindowFocus: false });

  /* documento: fixados primeiro, depois por criação */
  const documento = useMemo(() => {
    const todos = [...(cartoes ?? [])];
    const passa = (c: Cartao) =>
      filtro === "tudo" ? true
      : filtro === "fixados" ? c.fixado
      : filtro === "passos" ? c.itens.some((i) => i.tipo === "passo" && !i.feito)
      : c.tom === "alerta" || c.tom === "atencao";
    const filtrados = todos.filter(passa);
    const porData = (a: Cartao, b: Cartao) => b.criadoEm.localeCompare(a.criadoEm);
    return {
      fixados: filtrados.filter((c) => c.fixado).sort(porData),
      demais: filtrados.filter((c) => !c.fixado).sort(porData),
    };
  }, [cartoes, filtro]);
  const passosAbertos = (cartoes ?? []).reduce((s, c) => s + c.itens.filter((i) => i.tipo === "passo" && !i.feito).length, 0);

  /* projetos */
  const repos = useMemo(() => {
    const todos = dev?.repositorios ?? [];
    const pend = (r: (typeof todos)[number]) => r.alterados + r.naoRastreados + r.aFrente + r.atras;
    return [...todos].sort((a, b) => pend(b) - pend(a) || (b.ultimoCommitEm ?? "").localeCompare(a.ultimoCommitEm ?? ""));
  }, [dev]);
  const comPendencia = repos.filter((r) => r.alterados + r.naoRastreados + r.aFrente + r.atras > 0).length;

  /* fez: agrupado por execução */
  const grupos = useMemo(() => {
    const mapa = new Map<string, NonNullable<typeof acoes>>();
    for (const a of acoes ?? []) {
      const g = mapa.get(a.execucaoId) ?? [];
      g.push(a);
      mapa.set(a.execucaoId, g);
    }
    return [...mapa.values()];
  }, [acoes]);
  const hoje = new Date().toDateString();
  const fezHoje = (acoes ?? []).filter((a) => new Date(a.em).toDateString() === hoje).length;

  /* vai fazer: disparados/abertos primeiro, depois por proximaEm */
  const agenda = useMemo(
    () =>
      [...(compromissos ?? [])].sort((a, b) => {
        const pa = a.tipo === "vigia" && !a.armado ? 0 : 1;
        const pb = b.tipo === "vigia" && !b.armado ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return (a.proximaEm ?? "9").localeCompare(b.proximaEm ?? "9");
      }),
    [compromissos]
  );

  const memoriasVisiveis = (memorias ?? []).filter((m) => mostrarApagadas || !m.esquecida);
  const apagadas = (memorias ?? []).filter((m) => m.esquecida).length;

  if (loading || !user) {
    return (
      <main className="painel">
        <div className="boot-state">ABRINDO A MESA…</div>
      </main>
    );
  }

  const pergunta = execucao?.pergunta ?? null;
  const segundosDeExecucao = execucao ? Math.max(0, Math.round((Date.now() - execucao.iniciadaEm) / 1000)) : 0;

  return (
    <main className="painel">
      {/* ------------------------------------------------------------ faixa */}
      <header className="mesa-faixa">
        <span className="marca">JARVIS · MESA</span>

        {pergunta ? (
          <span className="estado pergunta">
            <i>?</i>
            <q>{pergunta.pergunta}</q>
            {pergunta.nivel !== "normal" ? <span>{pergunta.nivel}</span> : null}
            <span>{segundosDeExecucao}s</span>
            {pergunta.tipo === "texto" ? (
              <input
                value={respostaTexto}
                placeholder="responder…"
                onChange={(e) => setRespostaTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && respostaTexto.trim()) {
                    responder.mutate({ perguntaId: pergunta.id, texto: respostaTexto.trim(), origem: "clique" });
                    setRespostaTexto("");
                  }
                }}
              />
            ) : (
              <span className="opcoes">
                {(pergunta.opcoes ?? []).map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className={`acao ${o.perigo ? "perigo" : ""}`}
                    onClick={() => responder.mutate({ perguntaId: pergunta.id, opcaoId: o.id, origem: "clique" })}
                  >
                    {o.rotulo}
                  </button>
                ))}
              </span>
            )}
            <button type="button" className="acao" onClick={() => interromper.mutate({ execucaoId: execucao!.execucaoId })}>
              interromper
            </button>
          </span>
        ) : execucao ? (
          <span className="estado">
            <i>●</i>
            <span>{execucao.ferramentaAtual ?? "pensando"}</span>
            <span>há {segundosDeExecucao}s</span>
            <button type="button" className="acao" onClick={() => interromper.mutate({ execucaoId: execucao.execucaoId })}>
              interromper
            </button>
          </span>
        ) : (
          <span className="estado">repouso</span>
        )}

        <span className="contadores">
          {cartoes?.length ?? 0} registros · {compromissos?.length ?? 0} compromissos · {(memorias ?? []).filter((m) => !m.esquecida).length} memórias
        </span>

        {estado ? (
          <span className="ligacoes">
            <span>{estado.modelo}</span>
            <span className={estado.modelos.livres === 0 ? "esgotado" : ""}>
              modelos {estado.modelos.livres}/{estado.modelos.total}
              {estado.modelos.livres === 0 ? " — esgotados hoje" : ""}
            </span>
            <span>voz {estado.voz.restam} restam</span>
            {estado.ligacoes.map((l) => (
              <span key={l.nome} className={l.ligado ? "ok" : "falta"} title={l.ligado ? undefined : estado.motivoDeAusencia ?? undefined}>
                {l.nome}
              </span>
            ))}
          </span>
        ) : null}
      </header>

      {/* ------------------------------------------------------------ projetos */}
      <aside className="mesa-coluna">
        <Bloco titulo="Projetos" extra={repos.length ? (comPendencia ? `${comPendencia} com pendência` : "tudo limpo") : undefined}>
          {repos.length ? (
            <table className="mesa-repos">
              <thead>
                <tr>
                  <th>repo</th>
                  <th>ramo</th>
                  <th>pend.</th>
                  <th>último commit</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {repos.map((r) => {
                  const sujo = r.alterados + r.naoRastreados + r.aFrente + r.atras > 0;
                  const pend = sujo
                    ? [r.alterados ? `${r.alterados}±` : "", r.naoRastreados ? `${r.naoRastreados}?` : "", r.aFrente ? `↑${r.aFrente}` : "", r.atras ? `↓${r.atras}` : ""].filter(Boolean).join(" ")
                    : "·";
                  return (
                    <tr key={r.caminho} className={sujo ? "sujo" : ""} title={r.caminho}>
                      <td className="nome">{r.nome}</td>
                      <td>{r.ramo ?? "—"}</td>
                      <td>{pend}</td>
                      <td className="commit">{r.ultimoCommit ?? "sem commits"}</td>
                      <td className="quando">{haQuantoTempo(r.ultimoCommitEm).replace("há ", "")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="mesa-vazio">nenhum repositório git encontrado</p>
          )}
          {dev?.portas.length ? (
            <p className="mesa-noar">
              no ar:{" "}
              {dev.portas.map((p) => (
                <span key={p.porta}>
                  <b>{p.porta}</b> {p.processo ?? ""}
                </span>
              ))}
            </p>
          ) : null}
          {dev?.arquivos.length ? (
            <div className="mesa-mexidos">
              <h2 className="mesa-bloco-titulo">
                <span>Mexidos</span>
                <em>{haQuantoTempo(dev.medidoEm)}</em>
              </h2>
              {dev.arquivos.slice(0, 15).map((a) => (
                <div key={a.caminho} title={a.caminho}>
                  <span>{a.nome}</span>
                  <em>{tamanho(a.tamanhoBytes)}</em>
                  <small>{haQuantoTempo(a.modificadoEm).replace("há ", "")}</small>
                </div>
              ))}
            </div>
          ) : null}
        </Bloco>
      </aside>

      {/* ------------------------------------------------------------ documento */}
      <section className="mesa-coluna mesa-doc">
        <h2 className="mesa-bloco-titulo">
          <span>Deixado pelo Jarvis</span>
          <em>
            {cartoes?.length ?? 0} registros{passosAbertos ? ` · ${passosAbertos} passos abertos` : ""}
          </em>
          <span className="filtros">
            {(["tudo", "fixados", "passos", "alerta"] as Filtro[]).map((f) => (
              <button key={f} type="button" className={`acao ${filtro === f ? "ativo" : ""}`} onClick={() => setFiltro(f)}>
                {f === "passos" ? "passos abertos" : f}
              </button>
            ))}
          </span>
        </h2>

        {!cartoes?.length ? (
          <p className="mesa-vazio grande">Nada deixado ainda. Peça: "mostra no painel".</p>
        ) : documento.fixados.length + documento.demais.length === 0 ? (
          <p className="mesa-vazio">
            {filtro === "fixados" ? "nenhum fixado" : filtro === "passos" ? "nenhum com passos abertos" : "nenhum em alerta"}
          </p>
        ) : null}

        {documento.fixados.length ? <div className="mesa-rotulo-fixado">fixado</div> : null}
        {[...documento.fixados, ...documento.demais].map((c) => (
          <Secao
            key={c.id}
            cartao={c}
            confirmacao={confirmacao}
            aoFixar={() => atualizarCartao.mutate({ id: c.id, fixado: !c.fixado })}
            aoRemover={() => removerCartao.mutate({ id: c.id })}
            aoMarcar={(i, feito) => atualizarCartao.mutate({ id: c.id, passo: { indice: i, feito } })}
          />
        ))}
      </section>

      {/* ------------------------------------------------------------ direita */}
      <aside className="mesa-direita">
        <Bloco titulo="Vai fazer" extra={String(agenda.length)}>
          <div className="mesa-lista">
            {agenda.map((c) => {
              const chave = `comp-${c.id}`;
              const glifo = c.tipo === "lembrete" ? "◦" : c.tipo === "rotina" ? "↻" : "⌁";
              const linha2 =
                c.tipo === "lembrete" ? `${emQuanto(c.proximaEm)}${c.proximaEm ? ` · ${diaHora(c.proximaEm)}` : ""}`
                : c.tipo === "rotina" ? `${diasDaSemana(c.diasDaSemana)} ${minutosParaHora(c.horaDoDia)} · próxima ${emQuanto(c.proximaEm)}${c.disparos ? ` · disparou ${c.disparos}×` : ""}${c.ultimoDisparoEm ? ` · último ${haQuantoTempo(c.ultimoDisparoEm)}` : ""}`
                : `${c.metrica} ${c.comparacao === "acima" ? "acima de" : "abaixo de"} ${c.limite}% · ${c.armado ? "armado" : "disparado, esperando normalizar"}${c.ultimoDisparoEm ? ` · último ${haQuantoTempo(c.ultimoDisparoEm)}` : ""}`;
              return (
                <article key={c.id}>
                  <div className="linha1">
                    <i>{glifo}</i>
                    <span>{c.texto}</span>
                    <button type="button" className={`acao ${confirmacao.armada(chave) ? "confirmar" : ""}`} onClick={() => confirmacao.pedir(chave, () => cancelarCompromisso.mutate({ id: c.id }))}>
                      {confirmacao.armada(chave) ? "confirmar?" : "×"}
                    </button>
                  </div>
                  <div className={`linha2 ${c.tipo === "vigia" && !c.armado ? "aceso" : ""}`}>{linha2}</div>
                </article>
              );
            })}
            {!agenda.length ? <p className="mesa-vazio">nada prometido</p> : null}
          </div>
        </Bloco>

        <Bloco titulo="Fez" extra={fezHoje ? `hoje ${fezHoje}` : undefined} className="mesa-fez">
          <div className="mesa-lista">
            {grupos.slice(0, gruposVisiveis).map((g) => (
              <div key={g[0].execucaoId} className="grupo">
                <header>
                  <span>{g[0].pedido || "—"}</span>
                  <small>{haQuantoTempo(g[0].em)}</small>
                </header>
                {[...g].reverse().map((a) => (
                  <div key={a.id}>
                    <div className={`acao-linha ${!a.ok ? "falhou" : ""} ${acaoAberta === a.id ? "aberta" : ""}`} onClick={() => setAcaoAberta(acaoAberta === a.id ? null : a.id)}>
                      <span>{horaCurta(a.em)}</span>
                      <span>
                        {a.ferramenta} · <span className="status">{a.bloqueada ? "recusada" : a.ok ? "ok" : "falhou"}</span>
                      </span>
                      <span className="resumo">{a.resumo || a.detalhe}</span>
                    </div>
                    {acaoAberta === a.id && a.detalhe ? <pre className="detalhe">{a.detalhe}</pre> : null}
                  </div>
                ))}
              </div>
            ))}
            {!grupos.length ? <p className="mesa-vazio">nada executado ainda</p> : null}
            {grupos.length > gruposVisiveis ? (
              <button type="button" className="acao mesa-mais" onClick={() => setGruposVisiveis((n) => n + GRUPOS_DE_FEZ)}>
                mais {grupos.length - gruposVisiveis}
              </button>
            ) : null}
          </div>
        </Bloco>

        <Bloco
          titulo="Aprendeu"
          extra={
            apagadas ? (
              <button type="button" className="acao" onClick={() => setMostrarApagadas((a) => !a)}>
                {mostrarApagadas ? "ocultar apagadas" : `${apagadas} apagadas`}
              </button>
            ) : (
              String(memoriasVisiveis.length)
            )
          }
        >
          <div className="mesa-lista">
            {memoriasVisiveis.map((m) => {
              const chave = `mem-${m.id}`;
              return (
                <article key={m.id} className={`${m.fixada ? "fixada" : ""} ${m.esquecida ? "apagada" : ""}`}>
                  <div className="linha1">
                    <span>{m.conteudo}</span>
                    {m.esquecida ? (
                      <button type="button" className="acao" onClick={() => restaurar.mutate({ id: m.id })}>↶</button>
                    ) : (
                      <button type="button" className={`acao ${confirmacao.armada(chave) ? "confirmar" : ""}`} onClick={() => confirmacao.pedir(chave, () => esquecer.mutate({ id: m.id }))}>
                        {confirmacao.armada(chave) ? "esquecer?" : "×"}
                      </button>
                    )}
                  </div>
                  <div className="linha2">
                    {m.tipo}
                    {m.origem === "inferida" ? " · deduzida" : ""}
                    {m.versao > 1 ? (
                      <>
                        {" · "}
                        <span className="vN" onClick={() => setVersoesDe(versoesDe === m.id ? null : m.id)}>v{m.versao}</span>
                      </>
                    ) : null}
                    {m.usos > 0 ? ` · usada ${m.usos}×` : ""} · {haQuantoTempo(m.atualizadaEm)}
                  </div>
                  {versoesDe === m.id && versoes ? (
                    <div className="mesa-versoes">
                      {versoes.map((v) => (
                        <div key={v.versao}>
                          v{v.versao} · {haQuantoTempo(v.criadoEm)}{v.motivo ? ` · ${v.motivo}` : ""} · <q>{v.conteudo}</q>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
            {!memoriasVisiveis.length ? <p className="mesa-vazio">nada aprendido ainda</p> : null}
          </div>
        </Bloco>
      </aside>
    </main>
  );
}
