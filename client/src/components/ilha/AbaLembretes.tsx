import { useEffect, useRef, useState } from "react";
import { BellRing, CalendarClock, Loader2, Plus, TriangleAlert, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { descreverRotina, descreverVigia, quandoFalta, separarCompromissos } from "@/lib/miniSistema";

/**
 * O que ele vai avisar, e quando. Marcar aqui não passa pelo modelo: o "quando"
 * é interpretado pelo servidor enquanto o dono escreve, e a data resolvida
 * aparece embaixo ANTES de gravar — "amanhã às 9h" virando a data errada é
 * pior que não marcar.
 */

const DIAS = ["D", "S", "T", "Q", "Q", "S", "S"];
const NOMES_DOS_DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function useAtrasado<T>(valor: T, ms: number): T {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    const timer = window.setTimeout(() => setAtrasado(valor), ms);
    return () => window.clearTimeout(timer);
  }, [valor, ms]);
  return atrasado;
}

export function AbaLembretes({ agora }: { agora: Date }) {
  const utils = trpc.useUtils();
  const lista = trpc.compromissos.proximos.useQuery(undefined, { staleTime: 15_000 });
  const recarregar = () => utils.compromissos.proximos.invalidate();

  const [modo, setModo] = useState<"lembrete" | "rotina">("lembrete");
  const [texto, setTexto] = useState("");
  const [quando, setQuando] = useState("");
  const [hora, setHora] = useState("08:00");
  const [dias, setDias] = useState<number[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  const quandoAtrasado = useAtrasado(quando.trim(), 250);
  const leitura = trpc.compromissos.interpretar.useQuery(
    { quando: quandoAtrasado },
    { enabled: modo === "lembrete" && quandoAtrasado.length >= 2, staleTime: 10_000 }
  );

  const criarLembrete = trpc.compromissos.criarLembrete.useMutation();
  const criarRotina = trpc.compromissos.criarRotina.useMutation();
  const cancelar = trpc.compromissos.cancelar.useMutation({ onSuccess: recarregar });
  const pendente = criarLembrete.isPending || criarRotina.isPending;

  const textoRef = useRef<HTMLInputElement>(null);

  const marcar = async () => {
    if (!texto.trim() || pendente) return;
    setErro(null);
    try {
      const resultado =
        modo === "lembrete"
          ? await criarLembrete.mutateAsync({ texto, quando })
          : await criarRotina.mutateAsync({
              texto,
              horaDoDia: Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5)),
              diasDaSemana: dias,
            });
      if (!resultado.ok) {
        setErro(`Não marquei: ${resultado.motivo}.`);
        return;
      }
      setTexto("");
      setQuando("");
      setDias([]);
      await recarregar();
      textoRef.current?.focus({ preventScroll: true });
    } catch {
      setErro("Não consegui falar com o servidor.");
    }
  };

  const { lembretes, rotinas, vigias } = separarCompromissos(lista.data ?? []);
  const podeMarcar =
    texto.trim().length > 0 && (modo === "rotina" || (quando.trim().length > 0 && leitura.data?.ok !== false));

  return (
    <div className="aba-lembretes">
      <form
        className="lembrete-novo"
        onSubmit={(evento) => {
          evento.preventDefault();
          void marcar();
        }}
      >
        <div className="lembrete-modo" role="radiogroup" aria-label="Tipo">
          {(["lembrete", "rotina"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={modo === m}
              className={modo === m ? "ativo" : ""}
              onClick={() => {
                setModo(m);
                setErro(null);
              }}
            >
              {m === "lembrete" ? "Uma vez" : "Rotina"}
            </button>
          ))}
        </div>

        <div className="lembrete-campos">
          <input
            ref={textoRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={modo === "lembrete" ? "O que lembrar — ligar pro contador" : "O que dizer — resumo da manhã"}
            maxLength={300}
            aria-label="O que lembrar"
          />
          {modo === "lembrete" ? (
            <input
              className="curto"
              value={quando}
              onChange={(e) => setQuando(e.target.value)}
              placeholder="amanhã às 9h"
              maxLength={120}
              aria-label="Quando"
            />
          ) : (
            <input
              className="hora"
              type="time"
              value={hora}
              onChange={(e) => setHora(e.target.value || "08:00")}
              aria-label="Horário"
            />
          )}
          <button type="submit" className="ilha-enviar" disabled={!podeMarcar || pendente} title="Marcar">
            {pendente ? <Loader2 size={14} className="spin" /> : <Plus size={15} />}
          </button>
        </div>

        <div className="lembrete-dica">
          {modo === "lembrete" ? (
            quandoAtrasado.length >= 2 && leitura.data ? (
              leitura.data.ok ? (
                <span className="certo">→ {leitura.data.descricao}</span>
              ) : (
                <span className="errado">{leitura.data.motivo}</span>
              )
            ) : (
              <span>Escreva como fala: em 20 minutos, amanhã às 9h, sexta de manhã.</span>
            )
          ) : (
            <span className="lembrete-dias">
              {DIAS.map((letra, dia) => (
                <button
                  key={dia}
                  type="button"
                  className={dias.includes(dia) ? "ativo" : ""}
                  aria-pressed={dias.includes(dia)}
                  title={NOMES_DOS_DIAS[dia]}
                  onClick={() =>
                    setDias((atual) => (atual.includes(dia) ? atual.filter((d) => d !== dia) : [...atual, dia]))
                  }
                >
                  {letra}
                </button>
              ))}
              <em>
                {descreverRotina(
                  Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5)),
                  dias.join(",")
                )}
              </em>
            </span>
          )}
        </div>
        {erro ? <p className="ilha-erro-linha">{erro}</p> : null}
      </form>

      <div className="lembrete-listas">
        {lista.isLoading ? (
          <p className="mini-carregando">
            <Loader2 size={13} className="spin" /> carregando…
          </p>
        ) : lembretes.length + rotinas.length + vigias.length === 0 ? (
          <p className="mini-vazio">Nada marcado ainda. Escreva acima o que lembrar e quando.</p>
        ) : null}

        <Grupo titulo="Lembretes" icone={<BellRing size={12} />}>
          {lembretes.map((c) => (
            <Item key={c.id} texto={c.texto} quando={quandoFalta(c.proximaEm, agora)} aoCancelar={() => cancelar.mutate({ id: c.id })} />
          ))}
        </Grupo>
        <Grupo titulo="Rotinas" icone={<CalendarClock size={12} />}>
          {rotinas.map((c) => (
            <Item
              key={c.id}
              texto={c.texto}
              quando={descreverRotina(c.horaDoDia, c.diasDaSemana)}
              aoCancelar={() => cancelar.mutate({ id: c.id })}
            />
          ))}
        </Grupo>
        <Grupo titulo="Vigias" icone={<TriangleAlert size={12} />}>
          {vigias.map((c) => (
            <Item
              key={c.id}
              texto={c.texto}
              quando={descreverVigia(c.metrica, c.comparacao, c.limite)}
              aoCancelar={() => cancelar.mutate({ id: c.id })}
            />
          ))}
        </Grupo>
      </div>
    </div>
  );
}

function Grupo({ titulo, icone, children }: { titulo: string; icone: React.ReactNode; children: React.ReactNode[] }) {
  if (children.length === 0) return null;
  return (
    <section className="lembrete-grupo">
      <h3>
        {icone} {titulo}
      </h3>
      <ul className="mini-lista">{children}</ul>
    </section>
  );
}

/**
 * Cancelar em dois toques: o primeiro arma, o segundo confirma. Um lembrete
 * apagado por esbarrão é um aviso que não vai tocar — e ninguém percebe.
 */
function Item({ texto, quando, aoCancelar }: { texto: string; quando: string; aoCancelar: () => void }) {
  const [armado, setArmado] = useState(false);
  useEffect(() => {
    if (!armado) return;
    const timer = window.setTimeout(() => setArmado(false), 3000);
    return () => window.clearTimeout(timer);
  }, [armado]);

  return (
    <li>
      <div>
        <b>{texto}</b>
        <small>{quando}</small>
      </div>
      {armado ? (
        <button type="button" className="mini-confirmar" onClick={aoCancelar}>
          Cancelar?
        </button>
      ) : (
        <button type="button" className="ilha-botao pequeno" onClick={() => setArmado(true)} title="Cancelar">
          <X size={12} />
        </button>
      )}
    </li>
  );
}
