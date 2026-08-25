import { useEffect, useState } from "react";
import { BellRing, CalendarClock, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import { trpc } from "@/lib/trpc";

/**
 * A coluna direita: o mundo, e o que ele prometeu fazer.
 *
 * O contrário da esquerda, que olha para dentro da máquina. Aqui está o que
 * chega de fora e o que está marcado — hora, tempo, câmbio, compromissos. Tudo
 * que o Jarvis já busca por conta própria e que só existia na outra janela.
 *
 * Sem molduras, alinhado à direita, no mesmo tom de marcação de instrumento.
 */

const POLL_MUNDO_MS = 5 * 60 * 1000;
const POLL_AQUECENDO_MS = 3000;

function haQuantoTempo(iso: string | null): string {
  if (!iso) return "—";
  const quando = new Date(iso).getTime();
  if (Number.isNaN(quando)) return "—";

  const minutos = Math.round((quando - Date.now()) / 60000);
  if (minutos < 0) return "agora";
  if (minutos < 60) return `${minutos}min`;
  if (minutos < 60 * 24) return `${Math.floor(minutos / 60)}h`;
  return `${Math.floor(minutos / 1440)}d`;
}

export function ColunaDireita() {
  const [relogio, setRelogio] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setRelogio(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  /*
   * Os coletores do servidor devolvem cache e buscam em segundo plano, então a
   * primeira resposta vem vazia por construção. Enquanto vier vazia, insiste
   * rápido — senão a tela ficaria escrita "—" por cinco minutos.
   */
  const { data: mundo } = trpc.board.world.useQuery(undefined, {
    refetchInterval: (query) => {
      const d = query.state.data;
      const vazio = !d || (d.clima.temperatura === null && d.cotacoes.length === 0);
      return vazio ? POLL_AQUECENDO_MS : POLL_MUNDO_MS;
    },
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const { data: compromissos } = trpc.compromissos.proximos.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const clima = mundo?.clima;
  const hoje = clima?.dias?.[0];

  // O que vence antes vem primeiro; vigias não têm hora e ficam no fim.
  const agenda = [...(compromissos ?? [])]
    .sort((a, b) => (a.proximaEm ?? "z").localeCompare(b.proximaEm ?? "z"))
    .slice(0, 4);

  return (
    <div className="coluna direita">
      {/* ------------------------------------------------ relógio */}
      <section className="bloco">
        <div className="relogio">
          {relogio.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false })}
          <small>{relogio.toLocaleTimeString("pt-BR", { second: "2-digit" })}</small>
        </div>
        <div className="relogio-data">
          {relogio.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
        </div>
      </section>

      {/* ------------------------------------------------ tempo */}
      {clima?.temperatura !== null && clima?.temperatura !== undefined ? (
        <section className="bloco">
          <h3>
            <i />
            {clima.local ?? "TEMPO"}
          </h3>
          <div className="clima-linha">
            <b>{Math.round(clima.temperatura)}°</b>
            <span>{clima.descricao ?? ""}</span>
          </div>
          <div className="linha-dupla">
            <span>
              {hoje ? `${Math.round(hoje.minima)}° / ${Math.round(hoje.maxima)}°` : ""}
            </span>
            <b>
              {clima.umidade !== null ? `${clima.umidade}% umid` : ""}
              {hoje && hoje.chuva >= 20 ? ` · ${Math.round(hoje.chuva)}% chuva` : ""}
            </b>
          </div>
        </section>
      ) : null}

      {/* ------------------------------------------------ câmbio */}
      {mundo?.cotacoes?.length ? (
        <section className="bloco">
          <h3>
            <i />
            MERCADO
          </h3>
          {mundo.cotacoes.slice(0, 3).map((cotacao) => {
            const subiu = cotacao.variacaoPercentual >= 0;
            return (
              <div key={cotacao.par} className="cotacao-linha">
                <span>{cotacao.par.replace("-", "/")}</span>
                <b>
                  {cotacao.valor.toLocaleString("pt-BR", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </b>
                <em className={subiu ? "sobe" : "cai"}>
                  {subiu ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
                  {Math.abs(cotacao.variacaoPercentual).toFixed(2)}%
                </em>
              </div>
            );
          })}
        </section>
      ) : null}

      {/* ------------------------------------------------ agenda */}
      <section className="bloco">
        <h3>
          <i className={agenda.length > 0 ? "vivo" : ""} />
          MARCADO
        </h3>

        {agenda.length === 0 ? <p className="vazio-linha">nada marcado</p> : null}

        {agenda.map((item) => (
          <div key={item.id} className={`marcado tipo-${item.tipo}`}>
            {item.tipo === "vigia" ? (
              <TriangleAlert size={9} />
            ) : item.tipo === "rotina" ? (
              <CalendarClock size={9} />
            ) : (
              <BellRing size={9} />
            )}
            <span>{item.texto}</span>
            <em>
              {item.tipo === "vigia"
                ? `${item.metrica} ${item.comparacao === "acima" ? ">" : "<"}${item.limite}%`
                : haQuantoTempo(item.proximaEm)}
            </em>
          </div>
        ))}
      </section>
    </div>
  );
}
