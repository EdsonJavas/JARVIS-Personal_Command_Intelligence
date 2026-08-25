import { useEffect, useRef, useState } from "react";
import type { IniciativaJarvis } from "@shared/jarvisStream";
import { CAMINHO_INICIATIVAS } from "@shared/jarvisStream";

/**
 * Escuta o Jarvis falando primeiro.
 *
 * Fluxo próprio, aberto o tempo todo, separado do de execução: uma iniciativa
 * nasce do relógio do servidor e chega quando não há conversa nenhuma
 * acontecendo — que é justamente o caso que importa.
 *
 * Reconecta sozinho com espera crescente. Sem isso, a primeira queda de
 * conexão deixaria o Jarvis mudo pelo resto do dia, sem sintoma nenhum na tela.
 */

const ESPERA_INICIAL_MS = 2_000;
const ESPERA_MAXIMA_MS = 60_000;
/** Quantas iniciativas ficam na tela. As mais antigas somem. */
const MAX_NA_TELA = 6;

export type IniciativaNaTela = IniciativaJarvis & { lida: boolean };

export function useIniciativas(aoChegar?: (iniciativa: IniciativaJarvis) => void) {
  const [iniciativas, setIniciativas] = useState<IniciativaNaTela[]>([]);
  const [conectado, setConectado] = useState(false);

  // Por ref para a reconexão não recriar o fluxo a cada render do consumidor.
  const aoChegarRef = useRef(aoChegar);
  useEffect(() => {
    aoChegarRef.current = aoChegar;
  }, [aoChegar]);

  useEffect(() => {
    let fonte: EventSource | null = null;
    let tentativa = 0;
    let religar: number | null = null;
    let desmontado = false;

    const conectar = () => {
      if (desmontado) return;

      // EventSource aqui, e não fetch: é GET simples, e a reconexão automática
      // do navegador some quando a rota devolve erro — por isso a nossa.
      fonte = new EventSource(CAMINHO_INICIATIVAS, { withCredentials: true });

      fonte.onopen = () => {
        tentativa = 0;
        setConectado(true);
      };

      fonte.addEventListener("iniciativa", (evento) => {
        try {
          const iniciativa = JSON.parse((evento as MessageEvent).data) as IniciativaJarvis;
          setIniciativas((atual) => [{ ...iniciativa, lida: false }, ...atual].slice(0, MAX_NA_TELA));
          aoChegarRef.current?.(iniciativa);
        } catch {
          /* quadro corrompido: ignorar é melhor que derrubar o fluxo */
        }
      });

      fonte.onerror = () => {
        setConectado(false);
        fonte?.close();
        if (desmontado) return;

        // Espera crescente com teto: insistir a cada segundo contra um servidor
        // caído só gasta bateria e enche o log.
        const espera = Math.min(ESPERA_INICIAL_MS * 2 ** tentativa, ESPERA_MAXIMA_MS);
        tentativa += 1;
        religar = window.setTimeout(conectar, espera);
      };
    };

    conectar();

    return () => {
      desmontado = true;
      if (religar !== null) window.clearTimeout(religar);
      fonte?.close();
    };
  }, []);

  const marcarLida = (compromissoId: number) =>
    setIniciativas((atual) =>
      atual.map((item) => (item.compromissoId === compromissoId ? { ...item, lida: true } : item))
    );

  const dispensar = (compromissoId: number) =>
    setIniciativas((atual) => atual.filter((item) => item.compromissoId !== compromissoId));

  return { iniciativas, conectado, marcarLida, dispensar };
}
