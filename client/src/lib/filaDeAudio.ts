import { TAXA_SAIDA } from "@shared/vozAoVivo";

/**
 * Toca blocos de PCM que chegam em fluxo, sem estalo entre eles.
 *
 * A armadilha inteira está em `start()`. Chamado sem argumento, cada bloco
 * começa "agora" — e "agora" é depois do bloco anterior ter acabado, com um
 * buraco de alguns milissegundos no meio. O ouvido lê isso como estalo. A
 * correção é agendar cada bloco no instante EXATO em que o anterior termina.
 *
 * O colchão existe porque a rede varia. Ele começa pequeno e cresce sozinho
 * quando um bloco chega atrasado: um colchão fixo grande atrasaria toda
 * resposta para proteger de um caso raro.
 */

const COLCHAO_INICIAL = 0.08;
const COLCHAO_MAXIMO = 0.24;

export type FilaDeAudio = {
  enfileirar: (pcm: Int16Array) => void;
  /** Barge-in: descarta o que estava agendado, com rampa para não estalar. */
  descartar: () => void;
  tocando: () => boolean;
  encerrar: () => void;
};

export function criarFilaDeAudio(
  contexto: AudioContext,
  destino: AudioNode
): FilaDeAudio {
  const ganho = contexto.createGain();
  ganho.connect(destino);

  let proximoInicio = 0;
  let colchao = COLCHAO_INICIAL;
  const noAr = new Set<AudioBufferSourceNode>();

  return {
    enfileirar: (pcm) => {
      if (pcm.length === 0) return;

      const buffer = contexto.createBuffer(1, pcm.length, TAXA_SAIDA);
      const canal = buffer.getChannelData(0);
      // 32768 e não 32767: a escala de 16 bits é assimétrica, e dividir pelo
      // positivo faz o pico negativo estourar de leve.
      for (let i = 0; i < pcm.length; i += 1) canal[i] = pcm[i] / 32768;

      const fonte = contexto.createBufferSource();
      fonte.buffer = buffer;
      fonte.connect(ganho);

      const agora = contexto.currentTime;
      if (proximoInicio < agora + 0.02) {
        // A fila secou: o bloco chegou depois da hora dele. Alarga o colchão,
        // para o próximo trecho não repetir a falha.
        if (proximoInicio > 0) colchao = Math.min(COLCHAO_MAXIMO, colchao + 0.02);
        proximoInicio = agora + colchao;
      }

      fonte.start(proximoInicio);
      proximoInicio += buffer.duration;

      noAr.add(fonte);
      fonte.onended = () => noAr.delete(fonte);
    },

    descartar: () => {
      const agora = contexto.currentTime;
      // Rampa curta antes de cortar: parar uma onda no meio do ciclo estala.
      ganho.gain.cancelScheduledValues(agora);
      ganho.gain.setTargetAtTime(0, agora, 0.005);

      for (const fonte of noAr) {
        try {
          fonte.stop(agora + 0.02);
        } catch {
          /* já parou sozinha */
        }
      }
      noAr.clear();
      proximoInicio = 0;

      // Volume de volta para o próximo turno, depois da rampa.
      ganho.gain.setValueAtTime(1, agora + 0.04);
    },

    tocando: () => noAr.size > 0 || proximoInicio > contexto.currentTime,

    encerrar: () => {
      for (const fonte of noAr) {
        try {
          fonte.stop();
        } catch {
          /* já parou */
        }
      }
      noAr.clear();
      try {
        ganho.disconnect();
      } catch {
        /* já desconectado */
      }
    },
  };
}
