import { useRef } from "react";
import { useJarvisSession } from "@/contexts/JarvisSessionContext";
import { dividirResposta } from "@shared/fala";

/**
 * O que ele está dizendo, correndo no alto da tela.
 *
 * Voz some. Uma frase dita enquanto o dono olhava para outra janela deixa de
 * existir — e num assistente que narra o que faz, isso é justamente a parte que
 * importa. Aqui fica o rastro: o que ele falou, na ordem, com o que está sendo
 * dito agora em destaque.
 *
 * Separado da conversa de propósito. A conversa é o diálogo — o que o dono
 * pediu e a resposta final. Isto é a locução: narração de ação, pergunta,
 * iniciativa. Misturar os dois faria o histórico do pedido sumir no meio de
 * vinte linhas de "vou medir a máquina".
 */

/** Poucas: isto é legenda, não histórico. O histórico vive na conversa. */
const MAX_LINHAS = 12;

type Linha = { texto: string; tipo: "narracao" | "resposta" | "pergunta"; em: number };

export function Transcricao() {
  const { narracao, respostaParcial, messages, pergunta } = useJarvisSession();
  const linhasRef = useRef<Linha[]>([]);

  // Acumula sem duplicar: os estados chegam a cada render e a mesma narração
  // apareceria dezenas de vezes.
  const ultimaRef = useRef<string>("");

  const registrar = (texto: string, tipo: Linha["tipo"]) => {
    const limpo = texto.trim();
    if (!limpo || limpo === ultimaRef.current) return;
    ultimaRef.current = limpo;
    linhasRef.current = [...linhasRef.current, { texto: limpo, tipo, em: Date.now() }].slice(
      -MAX_LINHAS
    );
  };

  if (narracao) registrar(narracao, "narracao");
  if (pergunta) registrar(pergunta.pergunta, "pergunta");

  const ultimaMensagem = messages[messages.length - 1];
  // Só a parte falada: a legenda corre no alto da tela e não é lugar de tabela.
  if (ultimaMensagem?.role === "assistant") {
    registrar(dividirResposta(ultimaMensagem.content).fala, "resposta");
  }

  const linhas = linhasRef.current;

  return (
    <div className="transcricao" aria-live="polite">
      {/*
        As anteriores ficam esmaecidas acima; a atual, legível. É leitura de
        canto de olho: quem quiser o histórico completo abre a conversa.
      */}
      {linhas.slice(-4).map((linha, indice, visiveis) => (
        <p
          key={`${linha.em}-${indice}`}
          className={`legenda tipo-${linha.tipo} ${indice === visiveis.length - 1 ? "atual" : "anterior"}`}
          style={{ opacity: 0.18 + (indice / Math.max(1, visiveis.length - 1)) * 0.82 }}
        >
          {linha.texto}
        </p>
      ))}

      {respostaParcial ? <p className="legenda atual escrevendo">{respostaParcial}</p> : null}
    </div>
  );
}
