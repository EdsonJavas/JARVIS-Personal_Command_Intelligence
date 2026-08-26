// A MESA do Jarvis — segunda janela.
//
// Uma página que ROLA, em seções com cabeçalho forte, sem caixas. De cima
// para baixo, na ordem em que o dono decide o dia: o que está acontecendo
// agora; o dia dele (agenda e e-mails que pedem resposta, vindos do Google
// pela ponte MCP) com o briefing que o servidor redige; o que o Jarvis
// deixou — o documento; os projetos que pedem atenção; o que ele vai fazer e
// fez; o que aprendeu.
//
// Nada que a janela principal já mostra: sem máquina, relógio, clima.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { LOGIN_PATH } from "@/const";
import type { Cartao, ItemDoCartao } from "@shared/painel";

const POLL_CARTOES_MS = 3000;
const POLL_DEV_MS = 60 * 1000;
const POLL_EXECUCAO_MS = 2000;
const POLL_ESTADO_MS = 15 * 1000;
const POLL_HOJE_MS = 60 * 1000;
const POLL_COMPROMISSOS_MS = 30 * 1000;
const POLL_ACOES_MS = 5000;
const POLL_MEMORIAS_MS = 15 * 1000;

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
  return h < 24 ? `em ${h} h` : `em ${Math.floor(h / 24)} d`;
}
const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const diaHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { weekday: "short", hour: "2-digit", minute: "2-digit" }).replace(".", "");
const minutosParaHora = (min: number | null) => (min === null ? "" : `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`);
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
function diasDaSemana(texto: string | null) {
  if (!texto) return "todo dia";
  const dias = texto.split(",").map(Number).filter((n) => n >= 0 && n <= 6);
  if (dias.length === 0 || dias.length === 7) return "todo dia";
  if (dias.length === 5 && [1, 2, 3, 4, 5].every((d) => dias.includes(d))) return "seg–sex";
  return dias.map((d) => DIAS[d]).join(" ");
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

/* ----------------------------------- peças ---------------------------------- */

function Secao({ id, rotulo, titulo, resumo, extra, children }: { id: string; rotulo: string; titulo: string; resumo?: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="ms-secao" id={id}>
      <header className="ms-cabecalho">
        <small>{rotulo}</small>
        <div>
          <h2>{titulo}</h2>
          {extra ? <div className="ms-extra">{extra}</div> : null}
        </div>
        {resumo ? <p>{resumo}</p> : null}
      </header>
      {children}
    </section>
  );
}

function Pilula({ children, tom = "" }: { children: ReactNode; tom?: string }) {
  return <i className={`ms-pilula ${tom}`}>{children}</i>;
}

function Item({ item, indice, aoMarcar }: { item: ItemDoCartao; indice: number; aoMarcar: (i: number, feito: boolean) => void }) {
  switch (item.tipo) {
    case "metrica":
      return (
        <div className={`it-metrica ${item.tom ? `tom-${item.tom}` : ""}`}>
          <b>
            {item.valor}
            {item.unidade ? <span>{item.unidade}</span> : null}
            {item.tendencia ? <i>{item.tendencia === "sobe" ? "↑" : item.tendencia === "desce" ? "↓" : "→"}</i> : null}
          </b>
          <small>{item.rotulo}</small>
        </div>
      );
    case "progresso":
      return (
        <div className="it-progresso">
          <div><span>{item.rotulo}</span><b>{item.valor}%</b></div>
          <div className="trilho"><i style={{ width: `${item.valor}%` }} /></div>
          {item.texto ? <p>{item.texto}</p> : null}
        </div>
      );
    case "link":
      return (
        <a className="it-link" href={item.url} target="_blank" rel="noreferrer noopener">
          {item.rotulo ? <small>{item.rotulo}</small> : null}
          <span>{item.texto} ↗</span>
        </a>
      );
    case "lista":
      return (
        <div className="it-lista">
          {item.rotulo ? <small>{item.rotulo}</small> : null}
          <ul>{item.itens.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      );
    case "passo":
      return (
        <button type="button" className={`it-passo ${item.feito ? "feito" : ""}`} onClick={() => aoMarcar(indice, !item.feito)}>
          <i>{item.feito ? "✓" : ""}</i><span>{item.texto}</span>
        </button>
      );
    case "tabela":
      return (
        <div className="it-tabela">
          <table>
            <thead><tr>{item.colunas.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{item.linhas.map((l, i) => <tr key={i}>{l.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    case "codigo":
      return <pre className="it-codigo">{item.texto}</pre>;
    case "separador":
      return <div className="it-separador">{item.rotulo ? <span>{item.rotulo}</span> : null}</div>;
    default:
      return <p className="it-texto">{item.rotulo ? <small>{item.rotulo}</small> : null}{item.texto}</p>;
  }
}

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
      blocos.push(<div key={`m${i}`} className="it-metricas">{grupo}</div>);
    } else {
      blocos.push(<Item key={i} item={itens[i]} indice={i} aoMarcar={aoMarcar} />);
      i += 1;
    }
  }
  return <div className="ms-itens">{blocos}</div>;
}

type Filtro = "tudo" | "fixados" | "passos" | "alerta";

/* ---------------------------------- a mesa ---------------------------------- */

export default function Dashboard() {
  const { user, loading } = useAuth({ redirectOnUnauthenticated: true, redirectPath: LOGIN_PATH });
  const utils = trpc.useUtils();
  const confirmacao = useConfirmacao();

  const { data: cartoes } = trpc.board.cards.useQuery(undefined, { refetchInterval: POLL_CARTOES_MS, refetchOnWindowFocus: false });
  const { data: dev } = trpc.board.dev.useQuery(undefined, { refetchInterval: POLL_DEV_MS, refetchOnWindowFocus: false, retry: 1 });
  const { data: hoje } = trpc.board.hoje.useQuery(undefined, { refetchInterval: POLL_HOJE_MS, refetchOnWindowFocus: false, retry: 1 });
  const { data: execucao } = trpc.jarvis.execucaoAtiva.useQuery(undefined, { refetchInterval: POLL_EXECUCAO_MS, refetchOnWindowFocus: false, retry: false });
  const { data: estado } = trpc.jarvis.estado.useQuery(undefined, { refetchInterval: POLL_ESTADO_MS, refetchOnWindowFocus: false, retry: 1 });
  const { data: compromissos } = trpc.compromissos.proximos.useQuery(undefined, { refetchInterval: POLL_COMPROMISSOS_MS, refetchOnWindowFocus: false, retry: 1 });
  const { data: acoes } = trpc.jarvis.acoes.useQuery({ limite: 60 }, { refetchInterval: POLL_ACOES_MS, refetchOnWindowFocus: false, retry: 1 });
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
  const [acaoAberta, setAcaoAberta] = useState<number | null>(null);
  const [mostrarLimpos, setMostrarLimpos] = useState(false);
  const [mostrarApagadas, setMostrarApagadas] = useState(false);
  const [respostaTexto, setRespostaTexto] = useState("");
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setAgora(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const documento = useMemo(() => {
    const passa = (c: Cartao) =>
      filtro === "tudo" ? true : filtro === "fixados" ? c.fixado : filtro === "passos" ? c.itens.some((i) => i.tipo === "passo" && !i.feito) : c.tom === "alerta" || c.tom === "atencao";
    const porData = (a: Cartao, b: Cartao) => b.criadoEm.localeCompare(a.criadoEm);
    const f = (cartoes ?? []).filter(passa);
    return [...f.filter((c) => c.fixado).sort(porData), ...f.filter((c) => !c.fixado).sort(porData)];
  }, [cartoes, filtro]);
  const passosAbertos = (cartoes ?? []).reduce((s, c) => s + c.itens.filter((i) => i.tipo === "passo" && !i.feito).length, 0);

  const repos = useMemo(() => {
    const todos = dev?.repositorios ?? [];
    const pend = (r: (typeof todos)[number]) => r.alterados + r.naoRastreados + r.aFrente + r.atras;
    const ordenados = [...todos].sort((a, b) => pend(b) - pend(a) || (b.ultimoCommitEm ?? "").localeCompare(a.ultimoCommitEm ?? ""));
    return { sujos: ordenados.filter((r) => pend(r) > 0), limpos: ordenados.filter((r) => pend(r) === 0) };
  }, [dev]);

  const grupos = useMemo(() => {
    const mapa = new Map<string, NonNullable<typeof acoes>>();
    for (const a of acoes ?? []) mapa.set(a.execucaoId, [...(mapa.get(a.execucaoId) ?? []), a]);
    return [...mapa.values()].slice(0, 8);
  }, [acoes]);

  const agenda = useMemo(() => [...(compromissos ?? [])].sort((a, b) => (a.proximaEm ?? "9").localeCompare(b.proximaEm ?? "9")), [compromissos]);
  const memoriasVisiveis = (memorias ?? []).filter((m) => mostrarApagadas || !m.esquecida);
  const apagadas = (memorias ?? []).filter((m) => m.esquecida).length;

  if (loading || !user) return <main className="mesa"><div className="boot-state">ABRINDO A MESA…</div></main>;

  const pergunta = execucao?.pergunta ?? null;
  const segundos = execucao ? Math.max(0, Math.round((agora - execucao.iniciadaEm) / 1000)) : 0;
  const eventos = [...(hoje?.agenda.eventos ?? [])].sort((a, b) => (a.inicio ?? "9").localeCompare(b.inicio ?? "9"));
  const emailsQuePedem = (hoje?.email.naoLidos ?? []).filter((e) => e.pedeResposta);
  const outrosEmails = (hoje?.email.naoLidos ?? []).filter((e) => !e.pedeResposta);

  return (
    <main className="mesa">
      <div className="mesa-atmosfera" aria-hidden="true" />

      {/* ------------------------------------------------------------ topo */}
      <header className="mesa-topo">
        <span className="marca">JARVIS <i>//</i> MESA</span>
        {pergunta ? (
          <span className="estado pergunta">
            <b className="pulso" />
            <q>{pergunta.pergunta}</q>
            {pergunta.nivel !== "normal" ? <Pilula tom="aceso">{pergunta.nivel}</Pilula> : null}
            {pergunta.tipo === "texto" ? (
              <input value={respostaTexto} placeholder="responder…" onChange={(e) => setRespostaTexto(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && respostaTexto.trim()) { responder.mutate({ perguntaId: pergunta.id, texto: respostaTexto.trim(), origem: "clique" }); setRespostaTexto(""); } }} />
            ) : (
              (pergunta.opcoes ?? []).map((o) => (
                <button key={o.id} type="button" className={`acao ${o.perigo ? "perigo" : ""}`} onClick={() => responder.mutate({ perguntaId: pergunta.id, opcaoId: o.id, origem: "clique" })}>{o.rotulo}</button>
              ))
            )}
            <button type="button" className="acao" onClick={() => interromper.mutate({ execucaoId: execucao!.execucaoId })}>interromper</button>
          </span>
        ) : execucao ? (
          <span className="estado"><b className="pulso" />{execucao.ferramentaAtual ?? "pensando"} · há {segundos}s<button type="button" className="acao" onClick={() => interromper.mutate({ execucaoId: execucao.execucaoId })}>interromper</button></span>
        ) : (
          <span className="estado repouso"><b className="pulso quieto" />repouso</span>
        )}
        {estado ? (
          <span className="ligacoes">
            {estado.ligacoes.map((l) => <span key={l.nome} className={`led ${l.ligado ? "" : "off"}`} title={l.ligado ? undefined : estado.motivoDeAusencia ?? undefined}>{l.nome}</span>)}
            <span className="sep" />
            <span>{estado.modelo}</span>
            <span className={estado.modelos.livres === 0 ? "aceso" : ""}>modelos {estado.modelos.livres}/{estado.modelos.total}</span>
            <span className={`led ${estado.voz.restam <= 3 ? "warn" : ""}`}>voz {estado.voz.restam}</span>
          </span>
        ) : null}
      </header>

      {/* ------------------------------------------------------------ hoje */}
      <Secao id="hoje" rotulo="01 · HOJE" titulo={new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })} resumo={hoje?.briefing}>
        {hoje ? (
          <div className="ms-numeros">
            <div><b>{hoje.numeros.reunioes}</b><span>na agenda</span></div>
            <div><b>{hoje.numeros.emailsQuePedem}</b><span>e-mails pedem resposta</span></div>
            <div><b>{hoje.numeros.reposComPendencia}</b><span>repos com pendência</span></div>
            <div><b>{hoje.numeros.compromissos}</b><span>lembretes comigo</span></div>
          </div>
        ) : null}
        <div className="ms-duas">
          <div>
            <h3 className="ms-sub">Agenda {hoje && !hoje.agenda.ligada ? <Pilula>google desligado</Pilula> : null}</h3>
            {eventos.length ? (
              <ol className="ms-agenda">
                {eventos.map((e, i) => {
                  const passou = e.fim ? new Date(e.fim).getTime() < agora : e.inicio ? new Date(e.inicio).getTime() < agora - 60 * 60_000 : false;
                  const proximo = !passou && eventos.slice(0, i).every((x) => (x.fim ? new Date(x.fim).getTime() < agora : true));
                  return (
                    <li key={i} className={`${passou ? "passou" : ""} ${proximo ? "proximo" : ""}`}>
                      <time>{e.inicio ? hora(e.inicio) : "—"}</time>
                      <div><b>{e.titulo}</b><span>{[e.inicio && !passou ? emQuanto(e.inicio) : null, e.fim ? `até ${hora(e.fim)}` : null, e.local].filter(Boolean).join(" · ")}</span></div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="ms-vazio">{hoje?.agenda.ligada ? "nada na agenda hoje" : "ligue o Google para ver a agenda aqui"}</p>
            )}
          </div>
          <div>
            <h3 className="ms-sub">Pedem resposta {hoje?.email.ligado ? <em>{emailsQuePedem.length} de {hoje.email.naoLidos.length} não lidos</em> : <Pilula>gmail desligado</Pilula>}</h3>
            {emailsQuePedem.length || outrosEmails.length ? (
              <div className="ms-emails">
                {[...emailsQuePedem, ...outrosEmails.slice(0, Math.max(0, 6 - emailsQuePedem.length))].map((m, i) => (
                  <article key={i} className={m.pedeResposta ? "pede" : ""}>
                    <div><b>{m.de || "—"}</b><small>{m.quando ? haQuantoTempo(m.quando) : ""}</small></div>
                    <span>{m.assunto}</span>
                    {m.previa ? <p>{m.previa}</p> : null}
                  </article>
                ))}
              </div>
            ) : (
              <p className="ms-vazio">{hoje?.email.ligado ? "nenhum não lido nos últimos dois dias" : "ligue o Google para ver e-mails aqui"}</p>
            )}
          </div>
        </div>
      </Secao>

      {/* ------------------------------------------------------------ deixado */}
      <Secao
        id="deixado"
        rotulo="02 · DEIXADO PELO JARVIS"
        titulo={cartoes?.length ? `${cartoes.length} registro${cartoes.length === 1 ? "" : "s"}${passosAbertos ? ` · ${passosAbertos} passos abertos` : ""}` : "Nada deixado ainda"}
        extra={cartoes?.length ? (["tudo", "fixados", "passos", "alerta"] as Filtro[]).map((f) => <button key={f} type="button" className={`acao filtro ${filtro === f ? "ativo" : ""}`} onClick={() => setFiltro(f)}>{f === "passos" ? "passos abertos" : f}</button>) : null}
        resumo={cartoes?.length ? undefined : 'Peça por voz — "mostra no painel", "deixa isso aqui" — e o que ele apurar fica nesta seção, para sempre, até você ou ele remover.'}
      >
        {documento.map((c) => {
          const passos = c.itens.filter((i) => i.tipo === "passo");
          const feitos = passos.filter((i) => i.tipo === "passo" && i.feito).length;
          const chave = `c-${c.id}`;
          return (
            <article key={c.id} className={`ms-registro tom-${c.tom} ${c.fixado ? "fixado" : ""}`}>
              <header>
                <div className="linha">
                  {c.fixado ? <Pilula tom="aceso">fixado</Pilula> : null}
                  {c.tom !== "neutro" ? <Pilula tom={c.tom}>{c.tom}</Pilula> : null}
                  {passos.length ? <Pilula>{feitos}/{passos.length} passos</Pilula> : null}
                  <small>{haQuantoTempo(c.criadoEm)} · #{c.id}</small>
                  <span className="acoes">
                    <button type="button" className="acao" onClick={() => atualizarCartao.mutate({ id: c.id, fixado: !c.fixado })}>{c.fixado ? "soltar" : "fixar"}</button>
                    <button type="button" className={`acao ${confirmacao.armada(chave) ? "confirmar" : ""}`} onClick={() => confirmacao.pedir(chave, () => removerCartao.mutate({ id: c.id }))}>{confirmacao.armada(chave) ? "confirmar remoção?" : "remover"}</button>
                  </span>
                </div>
                <h3>{c.titulo}</h3>
                {c.subtitulo ? <p>{c.subtitulo}</p> : null}
              </header>
              <Itens itens={c.itens} aoMarcar={(i, feito) => atualizarCartao.mutate({ id: c.id, passo: { indice: i, feito } })} />
              {c.nota ? <footer>{c.nota}</footer> : null}
            </article>
          );
        })}
        {cartoes?.length && !documento.length ? <p className="ms-vazio">nenhum registro com esse filtro</p> : null}
      </Secao>

      {/* ------------------------------------------------------------ projetos */}
      <Secao id="projetos" rotulo="03 · PROJETOS" titulo={repos.sujos.length ? `${repos.sujos.length} pedem atenção` : "Tudo limpo"} resumo={dev?.portas.length ? `No ar agora: ${dev.portas.map((p) => `${p.porta}${p.processo ? ` (${p.processo})` : ""}`).join(", ")}.` : undefined}>
        <div className="ms-repos">
          {repos.sujos.map((r) => (
            <article key={r.caminho} title={r.caminho}>
              <div className="linha">
                <b>{r.nome}</b>
                <Pilula>{r.ramo ?? "—"}</Pilula>
                {r.alterados ? <Pilula tom="aceso">{r.alterados} alterado{r.alterados > 1 ? "s" : ""}</Pilula> : null}
                {r.naoRastreados ? <Pilula>{r.naoRastreados} novo{r.naoRastreados > 1 ? "s" : ""}</Pilula> : null}
                {r.aFrente ? <Pilula>↑{r.aFrente} sem push</Pilula> : null}
                {r.atras ? <Pilula tom="alerta">↓{r.atras} atrás</Pilula> : null}
                <small>{haQuantoTempo(r.ultimoCommitEm)}</small>
              </div>
              <p>{r.ultimoCommit ?? "sem commits"}</p>
            </article>
          ))}
          {!dev ? <p className="ms-vazio">procurando repositórios…</p> : null}
        </div>
        {repos.limpos.length ? (
          <div className="ms-limpos">
            <button type="button" className="acao" onClick={() => setMostrarLimpos((v) => !v)}>{mostrarLimpos ? "ocultar" : "ver"} {repos.limpos.length} limpos</button>
            {mostrarLimpos ? <p>{repos.limpos.map((r) => r.nome).join(" · ")}</p> : null}
          </div>
        ) : null}
        {dev?.arquivos.length ? (
          <div className="ms-mexidos">
            <h3 className="ms-sub">Mexidos <em>{haQuantoTempo(dev.medidoEm)}</em></h3>
            <div className="ms-mexidos-grade">{dev.arquivos.slice(0, 12).map((a) => <span key={a.caminho} title={a.caminho}>{a.nome}<small>{haQuantoTempo(a.modificadoEm).replace("há ", "")}</small></span>)}</div>
          </div>
        ) : null}
      </Secao>

      {/* ------------------------------------------------------------ vai fazer / fez */}
      <Secao id="ele" rotulo="04 · O JARVIS" titulo={`${agenda.length} prometido${agenda.length === 1 ? "" : "s"} · ${(acoes ?? []).length ? `${(acoes ?? []).length} ações recentes` : "nada executado ainda"}`}>
        <div className="ms-duas">
          <div>
            <h3 className="ms-sub">Vai fazer</h3>
            {agenda.length ? (
              <div className="ms-lista">
                {agenda.map((c) => {
                  const chave = `k-${c.id}`;
                  const linha2 = c.tipo === "lembrete" ? `${emQuanto(c.proximaEm)}${c.proximaEm ? ` · ${diaHora(c.proximaEm)}` : ""}` : c.tipo === "rotina" ? `${diasDaSemana(c.diasDaSemana)} ${minutosParaHora(c.horaDoDia)} · próxima ${emQuanto(c.proximaEm)}${c.disparos ? ` · disparou ${c.disparos}×` : ""}` : `${c.metrica} ${c.comparacao === "acima" ? "acima de" : "abaixo de"} ${c.limite}% · ${c.armado ? "armado" : "disparado"}`;
                  return (
                    <article key={c.id}>
                      <div className="linha"><Pilula>{c.tipo}</Pilula><b>{c.texto}</b><button type="button" className={`acao ${confirmacao.armada(chave) ? "confirmar" : ""}`} onClick={() => confirmacao.pedir(chave, () => cancelarCompromisso.mutate({ id: c.id }))}>{confirmacao.armada(chave) ? "cancelar?" : "×"}</button></div>
                      <small className={c.tipo === "vigia" && !c.armado ? "aceso" : ""}>{linha2}</small>
                    </article>
                  );
                })}
              </div>
            ) : <p className="ms-vazio">nada prometido — peça "me lembra…" ou "avisa quando…"</p>}
          </div>
          <div>
            <h3 className="ms-sub">Fez</h3>
            {grupos.length ? (
              <div className="ms-fez">
                {grupos.map((g) => (
                  <div key={g[0].execucaoId} className="grupo">
                    <header><span>{g[0].pedido || "—"}</span><small>{haQuantoTempo(g[0].em)}</small></header>
                    {[...g].reverse().map((a) => (
                      <div key={a.id}>
                        <div className={`linha ${!a.ok ? "falhou" : ""}`} onClick={() => setAcaoAberta(acaoAberta === a.id ? null : a.id)}>
                          <time>{hora(a.em)}</time>
                          <Pilula tom={a.bloqueada ? "" : a.ok ? "ok" : "alerta"}>{a.bloqueada ? "recusada" : a.ok ? "ok" : "falhou"}</Pilula>
                          <b>{a.ferramenta}</b>
                          <span>{a.resumo || a.detalhe}</span>
                        </div>
                        {acaoAberta === a.id && a.detalhe ? <pre>{a.detalhe}</pre> : null}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : <p className="ms-vazio">a trilha do que ele executa aparece aqui</p>}
          </div>
        </div>
      </Secao>

      {/* ------------------------------------------------------------ aprendeu */}
      <Secao id="aprendeu" rotulo="05 · APRENDEU" titulo={`${memoriasVisiveis.filter((m) => !m.esquecida).length} memória${memoriasVisiveis.length === 1 ? "" : "s"}`} extra={apagadas ? <button type="button" className="acao" onClick={() => setMostrarApagadas((v) => !v)}>{mostrarApagadas ? "ocultar apagadas" : `ver ${apagadas} apagadas`}</button> : null}>
        <div className="ms-memorias">
          {memoriasVisiveis.map((m) => {
            const chave = `m-${m.id}`;
            return (
              <article key={m.id} className={`${m.fixada ? "fixada" : ""} ${m.esquecida ? "apagada" : ""}`}>
                <p>{m.conteudo}</p>
                <div className="linha">
                  <Pilula tom={m.tipo === "correcao" ? "aceso" : ""}>{m.tipo}</Pilula>
                  {m.origem === "inferida" ? <Pilula>deduzida</Pilula> : null}
                  {m.fixada ? <Pilula tom="aceso">fixada</Pilula> : null}
                  <small>{m.usos > 0 ? `usada ${m.usos}× · ` : ""}{haQuantoTempo(m.atualizadaEm)}</small>
                  {m.esquecida ? <button type="button" className="acao" onClick={() => restaurar.mutate({ id: m.id })}>restaurar</button> : <button type="button" className={`acao ${confirmacao.armada(chave) ? "confirmar" : ""}`} onClick={() => confirmacao.pedir(chave, () => esquecer.mutate({ id: m.id }))}>{confirmacao.armada(chave) ? "esquecer?" : "esquecer"}</button>}
                </div>
              </article>
            );
          })}
          {!memoriasVisiveis.length ? <p className="ms-vazio">ele ainda não guardou nada</p> : null}
        </div>
      </Secao>
    </main>
  );
}
