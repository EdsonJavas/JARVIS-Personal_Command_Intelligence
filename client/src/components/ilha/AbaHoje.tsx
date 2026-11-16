import { CalendarDays, CloudSun, Loader2, Mail } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { quandoFalta } from "@/lib/miniSistema";

/**
 * O dia do dono: o resumo, a agenda, o que pede resposta e o tempo lá fora.
 *
 * O resumo vem pronto do servidor e é conta, não redação — não gasta cota. A
 * agenda e o e-mail só aparecem com o Google ligado; sem ele, a aba diz como
 * ligar em vez de mostrar um vazio que parece "não tenho nada hoje".
 */

/** "2026-11-16T09:00:00-03:00" ou "09:00": devolve "09:00" nos dois casos. */
function horaDoEvento(inicio: string | null): string {
  if (!inicio) return "—";
  const data = new Date(inicio);
  if (!Number.isNaN(data.getTime()) && inicio.includes("T")) {
    return data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  return inicio;
}

export function AbaHoje({ agora }: { agora: Date }) {
  const dia = trpc.board.hoje.useQuery(undefined, { staleTime: 60_000, refetchOnWindowFocus: false });
  const mundo = trpc.board.world.useQuery(undefined, { staleTime: 5 * 60_000, refetchOnWindowFocus: false });
  const compromissos = trpc.compromissos.proximos.useQuery(undefined, { staleTime: 30_000 });

  const clima = mundo.data?.clima;
  const hoje = clima?.dias?.[0];
  const proximos = (compromissos.data ?? [])
    .filter((c) => c.tipo !== "vigia" && c.proximaEm)
    .slice(0, 3);
  const pedemResposta = (dia.data?.email.naoLidos ?? []).filter((e) => e.pedeResposta).slice(0, 3);
  const googleLigado = Boolean(dia.data?.agenda.ligada || dia.data?.email.ligado);

  return (
    <div className="aba-hoje">
      <p className="hoje-resumo">
        {dia.isLoading ? (
          <span className="mini-carregando">
            <Loader2 size={13} className="spin" /> montando o seu dia…
          </span>
        ) : (
          dia.data?.briefing || "Dia tranquilo, senhor. Nada marcado por enquanto."
        )}
      </p>

      <div className="hoje-grade">
        <section className="mini-cartao">
          <h3>
            <CalendarDays size={12} /> Agenda
          </h3>
          {dia.data?.agenda.ligada ? (
            dia.data.agenda.eventos.length > 0 ? (
              <ul className="mini-lista">
                {dia.data.agenda.eventos.slice(0, 5).map((evento, i) => (
                  <li key={`${evento.titulo}-${i}`}>
                    <time>{horaDoEvento(evento.inicio)}</time>
                    <div>
                      <b>{evento.titulo}</b>
                      {evento.local ? <small>{evento.local}</small> : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mini-vazio">Nenhum compromisso na agenda hoje.</p>
            )
          ) : dia.isLoading ? null : (
            <p className="mini-vazio">
              Agenda não ligada. Na pasta do projeto: <code>npm run google:configurar</code>
            </p>
          )}

          {pedemResposta.length > 0 ? (
            <>
              <h3 className="mini-subtitulo">
                <Mail size={12} /> Pedem resposta
              </h3>
              <ul className="mini-lista">
                {pedemResposta.map((email, i) => (
                  <li key={`${email.assunto}-${i}`}>
                    <div>
                      <b>{email.assunto || "(sem assunto)"}</b>
                      <small>{email.de}</small>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : googleLigado && dia.data?.email.ligado ? (
            <p className="mini-vazio mini-nota">Nenhum e-mail pedindo resposta.</p>
          ) : null}
        </section>

        <div className="hoje-lateral">
          <section className="mini-cartao clima">
            <h3>
              <CloudSun size={12} /> Tempo
            </h3>
            {clima?.temperatura !== null && clima?.temperatura !== undefined ? (
              <>
                <div className="clima-agora">
                  <b>{Math.round(clima.temperatura)}°</b>
                  <span>{clima.descricao ?? ""}</span>
                </div>
                <small>
                  {[
                    clima.local,
                    hoje ? `máx ${Math.round(hoje.maxima)}° · mín ${Math.round(hoje.minima)}°` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
                {hoje && hoje.chuva >= 40 ? <small className="clima-chuva">{hoje.chuva}% de chuva</small> : null}
              </>
            ) : (
              <p className="mini-vazio">Sem leitura do tempo agora.</p>
            )}
          </section>

          <section className="mini-cartao">
            <h3>A seguir</h3>
            {proximos.length > 0 ? (
              <ul className="mini-lista compacta">
                {proximos.map((c) => (
                  <li key={c.id}>
                    <div>
                      <b>{c.texto}</b>
                      <small>{quandoFalta(c.proximaEm, agora)}</small>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mini-vazio">Nenhum lembrete marcado.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
