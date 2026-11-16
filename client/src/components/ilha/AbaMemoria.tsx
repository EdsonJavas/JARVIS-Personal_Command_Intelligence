import { useEffect, useState } from "react";
import { ChevronRight, Loader2, Pin, Search } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { filtrarMemorias } from "@/lib/miniSistema";

/**
 * O que o Jarvis sabe sobre o dono, à vista e apagável.
 *
 * Esquecer é reversível: a memória vai para "esquecidas" e um "desfazer" fica
 * na tela por alguns segundos. Apagar de vez o que ele aprendeu com um clique
 * errado seria perder algo que levou conversas para formar.
 */

const ROTULOS = {
  fato: "fato",
  preferencia: "preferência",
  projeto: "projeto",
  correcao: "correção",
} as const;

export function AbaMemoria() {
  const utils = trpc.useUtils();
  const lista = trpc.memoria.listar.useQuery(undefined, { staleTime: 15_000 });
  const recarregar = () => utils.memoria.listar.invalidate();
  const esquecer = trpc.memoria.esquecer.useMutation({ onSuccess: recarregar });
  const restaurar = trpc.memoria.restaurar.useMutation({ onSuccess: recarregar });

  const [busca, setBusca] = useState("");
  const [verEsquecidas, setVerEsquecidas] = useState(false);
  const [desfazer, setDesfazer] = useState<{ id: number; conteudo: string } | null>(null);

  useEffect(() => {
    if (!desfazer) return;
    const timer = window.setTimeout(() => setDesfazer(null), 6000);
    return () => window.clearTimeout(timer);
  }, [desfazer]);

  const { ativas, esquecidas } = filtrarMemorias(lista.data ?? [], busca);

  return (
    <div className="aba-memoria">
      <label className="memoria-busca">
        <Search size={13} />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar no que ele sabe sobre o senhor"
          aria-label="Buscar memórias"
        />
        <span>{ativas.length}</span>
      </label>

      {desfazer ? (
        <div className="memoria-desfazer" role="status">
          <span>Esquecida.</span>
          <button
            type="button"
            onClick={() => {
              restaurar.mutate({ id: desfazer.id });
              setDesfazer(null);
            }}
          >
            Desfazer
          </button>
        </div>
      ) : null}

      {lista.isLoading ? (
        <p className="mini-carregando">
          <Loader2 size={13} className="spin" /> carregando…
        </p>
      ) : ativas.length === 0 && !busca ? (
        <p className="mini-vazio">
          Ele ainda não guardou nada sobre o senhor. Aprende sozinho nas conversas da Ponte.
        </p>
      ) : ativas.length === 0 ? (
        <p className="mini-vazio">Nada com “{busca}”.</p>
      ) : null}

      <ul className="mini-lista memoria-lista">
        {ativas.map((m) => (
          <li key={m.id}>
            <span className={`memoria-tipo tipo-${m.tipo}`}>{ROTULOS[m.tipo as keyof typeof ROTULOS] ?? m.tipo}</span>
            <div>
              <b>
                {m.fixada ? <Pin size={10} className="memoria-fixa" aria-label="fixada" /> : null}
                {m.conteudo}
              </b>
            </div>
            <button
              type="button"
              className="mini-texto-botao"
              onClick={() => {
                esquecer.mutate({ id: m.id });
                setDesfazer({ id: m.id, conteudo: m.conteudo });
              }}
            >
              Esquecer
            </button>
          </li>
        ))}
      </ul>

      {esquecidas.length > 0 ? (
        <section className="memoria-esquecidas">
          <button
            type="button"
            className="mini-texto-botao"
            aria-expanded={verEsquecidas}
            onClick={() => setVerEsquecidas((v) => !v)}
          >
            <ChevronRight size={12} className={verEsquecidas ? "girado" : ""} /> Esquecidas ({esquecidas.length})
          </button>
          {verEsquecidas ? (
            <ul className="mini-lista">
              {esquecidas.map((m) => (
                <li key={m.id} className="apagada">
                  <div>
                    <b>{m.conteudo}</b>
                  </div>
                  <button type="button" className="mini-texto-botao" onClick={() => restaurar.mutate({ id: m.id })}>
                    Restaurar
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
