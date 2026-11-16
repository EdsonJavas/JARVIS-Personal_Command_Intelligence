import { ShieldAlert, Terminal } from "lucide-react";
import { useJarvisSession } from "@/contexts/JarvisSessionContext";

/**
 * A pergunta aberta: a execução está parada esperando esta resposta.
 *
 * Um componente só, usado pela Ponte e pela ilha. A regra que ele carrega não
 * pode divergir entre as duas: ação destrutiva só se confirma por clique.
 */
export function PerguntaCard() {
  const { pergunta, responder } = useJarvisSession();
  if (!pergunta) return null;

  return (
    <div className={`pergunta-card nivel-${pergunta.nivel}`} role="alertdialog">
      <div className="pergunta-topo">
        {pergunta.nivel === "normal" ? <Terminal size={13} /> : <ShieldAlert size={13} />}
        <span>
          {pergunta.nivel === "critico"
            ? "AÇÃO CRÍTICA"
            : pergunta.nivel === "destrutivo"
              ? "AÇÃO DESTRUTIVA"
              : "PRECISO DE UMA DECISÃO"}
        </span>
      </div>

      <p className="pergunta-texto">{pergunta.pergunta}</p>
      {pergunta.impacto ? <p className="pergunta-impacto">{pergunta.impacto}</p> : null}
      {pergunta.detalheTecnico ? (
        <pre className="pergunta-tecnico">{pergunta.detalheTecnico}</pre>
      ) : null}

      <div className="pergunta-opcoes">
        {pergunta.opcoes.map((opcao) => (
          <button
            key={opcao.id}
            type="button"
            className={opcao.perigo ? "perigo" : ""}
            onClick={() => responder({ opcaoId: opcao.id, origem: "clique" })}
            title={opcao.detalhe}
          >
            {opcao.rotulo}
            {opcao.detalhe ? <small>{opcao.detalhe}</small> : null}
          </button>
        ))}
      </div>

      {pergunta.tipo === "confirmacao" ? (
        <p className="pergunta-nota">
          Ações destrutivas só são autorizadas por clique — responder por voz não confirma.
        </p>
      ) : null}
    </div>
  );
}
