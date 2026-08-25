/**
 * Política de voz durante uma execução.
 *
 * A decisão central: QUANDO a voz local do navegador já é neural — as vozes
 * "Online (Natural)" da Microsoft, que o Edge expõe — ela ganha de longe da
 * síntese do Gemini. É instantânea, ilimitada e gratuita, contra 2 a 7 segundos
 * de espera e um teto de dez requisições por dia. Nesse caso tudo é falado
 * localmente, e o Jarvis mantém UM timbre só do começo ao fim da conversa.
 *
 * A síntese do Gemini fica reservada para quando a voz local é uma das SAPI
 * antigas do Windows: aí o timbre metálico justifica a espera e a cota, e a
 * escassez obriga a escolher onde gastar.
 */

export type DecisaoFala = "neural" | "local" | "silencio";
export type PapelDeFala = "narracao" | "resposta" | "pergunta";
export type ModoDeNarracao = "neural" | "local" | "muda";

export type EstadoDeFala = {
  papel: PapelDeFala;
  neuraisGastas: number;
  maxNeurais: number;
  narracaoFalada: ModoDeNarracao;
  vozLigada: boolean;
  cotaEstourada: boolean;
  /** A voz do navegador já é neural? Se sim, ela é a melhor opção disponível. */
  vozLocalEhNatural?: boolean;
  /** Há voz neural rodando NA MÁQUINA? Se sim, ela ganha de todas. */
  vozDoServidor?: boolean;
};

export function decidirFala(estado: EstadoDeFala): DecisaoFala {
  // Desligar a voz é decisão explícita do dono e vale para tudo, inclusive
  // pergunta.
  if (!estado.vozLigada) return "silencio";

  /*
   * A voz do servidor ganha de todas quando existe.
   *
   * É neural, roda na máquina, não tem cota nenhuma e soa igual em qualquer
   * navegador — que era exatamente o requisito. Não depender do navegador é o
   * ponto: as vozes boas da Microsoft só aparecem no Edge, e este Windows tem
   * instaladas apenas as da geração antiga.
   */
  if (estado.vozDoServidor) {
    return estado.papel === "narracao" && estado.narracaoFalada === "muda" ? "silencio" : "neural";
  }

  /*
   * Voz local neural vence sempre que existe.
   *
   * Não é economia, é qualidade de uso: ela fala na hora, sem teto diário e sem
   * a ida à rede que fazia a voz chegar depois da execução. Só a narração
   * explicitamente desligada continua muda.
   */
  if (estado.vozLocalEhNatural) {
    return estado.papel === "narracao" && estado.narracaoFalada === "muda" ? "silencio" : "local";
  }

  if (estado.papel === "pergunta") {
    // Pergunta é sempre falada e NÃO consome a cota de narração. Uma pergunta
    // que surgisse na terceira rodada cairia fora do teto e seria silenciada —
    // e a execução ficaria minutos parada esperando resposta a algo que o dono
    // nunca ouviu.
    return estado.cotaEstourada ? "local" : "neural";
  }

  if (estado.papel === "resposta") {
    // A resposta final tem prioridade sobre qualquer narração.
    return estado.cotaEstourada ? "local" : "neural";
  }

  if (estado.narracaoFalada === "muda") return "silencio";
  if (estado.narracaoFalada === "local") return "local";
  if (estado.cotaEstourada) return "local";
  return estado.neuraisGastas < estado.maxNeurais ? "neural" : "silencio";
}

export type FilaDeFala = {
  narrar: (texto: string) => void;
  /** Prioridade máxima e fora da cota. */
  perguntar: (texto: string) => void;
  /** Corta a narração em curso. */
  responder: (texto: string) => void;
  marcarCotaEstourada: () => void;
  encerrar: () => void;
};

export type DependenciasDeFala = {
  /**
   * Tem que resolver quando a fala ACABA, não quando começa.
   *
   * O papel viaja junto porque a cota diária de voz neural é curtíssima: anúncio
   * de ação cede a vez à resposta quando o saldo aperta.
   */
  falarNeural: (texto: string, papel: PapelDeFala) => Promise<void>;
  falarLocal: (texto: string) => void | Promise<void>;
  pararFala: () => void;
  vozLigada: () => boolean;
  /** Consultado a cada fala: a lista de vozes do navegador chega assíncrona. */
  vozLocalEhNatural?: () => boolean;
  vozDoServidor?: () => boolean;
  maxNeurais?: number;
  narracaoFalada?: ModoDeNarracao;
};

type ItemDeFala = { papel: PapelDeFala; texto: string };

/**
 * Fila de verdade, com um consumidor só.
 *
 * Antes isto disparava a fala sem esperar a anterior, e `speak` começa cortando
 * o áudio em curso: em qualquer tarefa de dois passos a segunda narração
 * atropelava a primeira no meio da palavra, e o dono nunca ouvia uma frase
 * inteira. Agora cada fala espera a anterior terminar.
 *
 * Resposta e pergunta continuam com prioridade: elas descartam a narração que
 * ainda não saiu e cortam a que está no ar — ouvir "vou procurar" por cima da
 * resposta pronta é pior do que perder a narração.
 */
export function criarFilaDeFala(deps: DependenciasDeFala): FilaDeFala {
  const maxNeurais = deps.maxNeurais ?? 2;
  const narracaoFalada = deps.narracaoFalada ?? "neural";

  let neuraisGastas = 0;
  let cotaEstourada = false;
  let encerrada = false;

  let fila: ItemDeFala[] = [];
  let consumindo = false;

  /**
   * A decisão é tomada na HORA DE FALAR, não na de enfileirar: a cota pode
   * estourar enquanto o item espera a vez, e o dono pode desligar a voz no meio.
   */
  const falar = async (item: ItemDeFala): Promise<void> => {
    const decisao = decidirFala({
      papel: item.papel,
      neuraisGastas,
      maxNeurais,
      narracaoFalada,
      vozLigada: deps.vozLigada(),
      cotaEstourada,
      vozLocalEhNatural: deps.vozLocalEhNatural?.() ?? false,
      vozDoServidor: deps.vozDoServidor?.() ?? false,
    });

    if (decisao === "silencio") return;

    if (decisao === "local") {
      await deps.falarLocal(item.texto);
      return;
    }

    if (item.papel === "narracao") neuraisGastas += 1;

    try {
      await deps.falarNeural(item.texto, item.papel);
    } catch {
      // Falha na neural não pode virar silêncio: cai para a local e para de
      // tentar a neural no resto da execução.
      cotaEstourada = true;
      await deps.falarLocal(item.texto);
    }
  };

  const consumir = async (): Promise<void> => {
    if (consumindo) return;
    consumindo = true;
    try {
      while (fila.length > 0 && !encerrada) {
        const item = fila.shift()!;
        await falar(item);
      }
    } finally {
      consumindo = false;
    }
  };

  const enfileirar = (papel: PapelDeFala, texto: string) => {
    if (encerrada || !texto.trim()) return;

    if (papel !== "narracao") {
      // Narração que ainda não saiu perdeu a validade, e a que está no ar é
      // cortada. `pararFala` resolve a espera do consumidor, então ele segue
      // para o item novo em vez de travar.
      fila = fila.filter((item) => item.papel !== "narracao");
      deps.pararFala();
    }

    fila.push({ papel, texto });
    void consumir();
  };

  return {
    narrar: (texto) => enfileirar("narracao", texto),
    perguntar: (texto) => enfileirar("pergunta", texto),
    responder: (texto) => enfileirar("resposta", texto),
    marcarCotaEstourada: () => {
      cotaEstourada = true;
    },
    encerrar: () => {
      encerrada = true;
      fila = [];
      deps.pararFala();
    },
  };
}
