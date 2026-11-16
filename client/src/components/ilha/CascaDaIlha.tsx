import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "framer-motion";
import type { FormaDaIlha } from "@/lib/ilhaEstado";
import { desktop, useNaMesa } from "@/lib/desktop";

/**
 * A casca da ilha: o formato preto que muda de tamanho.
 *
 * Mede o conteúdo e anima largura, altura e raio até ele com mola, que é o que
 * dá a sensação da ilha do iPhone — a forma estica, passa um pouco e assenta.
 * O conteúdo de cada forma entra e sai com desfoque, e não com troca seca: sem
 * o desfoque, por um instante se veem dois objetos sobrepostos, e o olho lê
 * "duas coisas trocando" em vez de "uma coisa se transformando".
 */

const LARGURA: Record<FormaDaIlha, number> = {
  repouso: 172,
  atividade: 384,
  aviso: 404,
  // O mini sistema: largo o bastante para o dia em duas colunas.
  expandida: 640,
};

const ALTURA_MINIMA: Record<FormaDaIlha, number> = {
  repouso: 36,
  atividade: 36,
  aviso: 56,
  expandida: 96,
};

const RAIO: Record<FormaDaIlha, number> = {
  repouso: 18,
  atividade: 18,
  aviso: 26,
  expandida: 30,
};

/*
 * Abrir pode passar um pouco do ponto; fechar, não. Quem fecha já decidiu e
 * está voltando ao que fazia: a ilha sai do caminho rápido e sem quicar.
 */
const MOLA_ABRINDO: Transition = { type: "spring", visualDuration: 0.42, bounce: 0.26 };
const MOLA_FECHANDO: Transition = { type: "spring", visualDuration: 0.32, bounce: 0.1 };
const SEM_MOLA: Transition = { duration: 0.14, ease: [0.23, 1, 0.32, 1] };

const TROCA: Transition = { duration: 0.2, ease: [0.23, 1, 0.32, 1] };

type Props = {
  forma: FormaDaIlha;
  /** Muda quando o CONTEÚDO muda, não só a forma: dispara a troca com desfoque. */
  chave: string;
  /** Clique na ilha fora da forma expandida. */
  aoClicar?: () => void;
  /** O mouse entrou ou saiu. Avisos passageiros não somem com o dono lendo. */
  aoPairar?: (sobre: boolean) => void;
  rotulo: string;
  children: ReactNode;
};

export function CascaDaIlha({ forma, chave, aoClicar, aoPairar, rotulo, children }: Props) {
  const reduzir = useReducedMotion();
  const conteudoRef = useRef<HTMLDivElement>(null);
  const [altura, setAltura] = useState(ALTURA_MINIMA[forma]);
  const formaAnterior = useRef(forma);

  useLayoutEffect(() => {
    const no = conteudoRef.current;
    if (!no) return;
    const medir = () => setAltura(no.offsetHeight);
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(no);
    return () => observador.disconnect();
  }, []);

  const crescendo = LARGURA[forma] >= LARGURA[formaAnterior.current];
  useEffect(() => {
    formaAnterior.current = forma;
  }, [forma]);

  const transicao = reduzir ? SEM_MOLA : crescendo ? MOLA_ABRINDO : MOLA_FECHANDO;
  const expandida = forma === "expandida";

  /*
   * A janela deixa o clique passar em tudo que não é a ilha. Ao sair do app a
   * janela fica com o clique preso se a ilha sumir debaixo do cursor, então a
   * ilha devolve o clique ao desmontar.
   */
  useEffect(() => () => desktop.interativa(false), []);

  /*
   * Abriu uma janela: a ilha sai de cena antes de o app de mesa esconder a
   * janela dela — some suave em vez de piscar. E devolve o clique, para não
   * ficar segurando um retângulo invisível.
   */
  const naMesa = useNaMesa();
  useEffect(() => {
    if (!naMesa) desktop.interativa(false);
  }, [naMesa]);

  return (
    <div className={`ilha-raiz ${naMesa ? "" : "fora-da-mesa"}`}>
      <motion.div
        className={`ilha forma-${forma}`}
        role={expandida ? "dialog" : "button"}
        aria-label={rotulo}
        aria-expanded={expandida}
        tabIndex={expandida ? -1 : 0}
        initial={false}
        animate={{
          width: LARGURA[forma],
          height: Math.max(ALTURA_MINIMA[forma], altura),
          borderRadius: RAIO[forma],
        }}
        transition={transicao}
        onMouseEnter={() => {
          desktop.interativa(true);
          aoPairar?.(true);
        }}
        onMouseLeave={() => {
          desktop.interativa(false);
          aoPairar?.(false);
        }}
        onClick={expandida ? undefined : aoClicar}
        onKeyDown={(evento) => {
          if (!expandida && (evento.key === "Enter" || evento.key === " ")) {
            evento.preventDefault();
            aoClicar?.();
          }
        }}
      >
        <div ref={conteudoRef} className="ilha-conteudo" style={{ width: LARGURA[forma] }}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={chave}
              className="ilha-camada"
              initial={reduzir ? { opacity: 0 } : { opacity: 0, filter: "blur(8px)", scale: 0.96 }}
              animate={reduzir ? { opacity: 1 } : { opacity: 1, filter: "blur(0px)", scale: 1 }}
              exit={reduzir ? { opacity: 0 } : { opacity: 0, filter: "blur(8px)", scale: 0.96 }}
              transition={TROCA}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

/**
 * Aberta pelo dono, e tudo que abre ou fecha a ilha.
 *
 * Clique e Ctrl+Alt+J abrem; Esc, clique fora e o mesmo atalho fecham. Abrir
 * pede o teclado para a janela; fechar devolve. Fechada, a ilha nunca segura o
 * foco: o dono pode estar no meio de uma frase em outro programa.
 */
export function useAbertura() {
  const [aberta, setAberta] = useState(false);
  const abertaRef = useRef(aberta);
  abertaRef.current = aberta;

  const abrir = useCallback(() => {
    setAberta(true);
    desktop.foco(true);
  }, []);

  const fechar = useCallback(() => {
    setAberta(false);
    desktop.foco(false);
  }, []);

  useEffect(
    () =>
      desktop.aoAlternar(() => {
        if (abertaRef.current) fechar();
        else abrir();
      }),
    [abrir, fechar]
  );

  // Clique fora. Só fecha o que o dono abriu: uma pergunta pendente continua
  // à vista, porque é a forma, e não esta flag, que a mantém aberta.
  useEffect(() => desktop.aoPerderFoco(() => setAberta(false)), []);

  // Abriu uma janela: a ilha sai da mesa fechada, e volta como pílula.
  useEffect(
    () =>
      desktop.aoMudarMesa((naMesa) => {
        if (!naMesa) setAberta(false);
      }),
    []
  );

  useEffect(() => {
    if (!aberta) return;
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") fechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberta, fechar]);

  return { aberta, abrir, fechar };
}
