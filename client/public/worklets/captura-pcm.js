/**
 * Captura do microfone em PCM 16 bits, 16 kHz, mono, little-endian.
 *
 * Arquivo estático de propósito, e não módulo do bundler: `addModule` carrega
 * por URL, e `client/public` é servido igual em desenvolvimento e produção.
 *
 * O motor entrega 128 amostras por vez. Mandar 128 amostras (8 ms) ao servidor
 * seriam 125 mensagens por segundo para 256 bytes cada — quase tudo cabeçalho.
 * Blocos de 40 ms são o meio-termo: 25 mensagens por segundo, e a interrupção
 * continua reagindo dentro de um quadro.
 */
registerProcessor(
  "captura-pcm",
  class extends AudioWorkletProcessor {
    constructor(opcoes) {
      super();
      const o = (opcoes && opcoes.processorOptions) || {};
      this.tamanho = o.amostrasPorBloco || 640;
      // 1 quando o contexto já nasceu a 16 kHz, que é o caso normal: deixar o
      // navegador reamostrar em código nativo é melhor que qualquer laço aqui.
      this.razao = sampleRate / (o.taxaAlvo || 16000);
      this.buffer = new Float32Array(this.tamanho);
      this.usado = 0;
      this.fase = 0;
      this.ligado = true;
      this.port.onmessage = (e) => {
        this.ligado = e.data !== "parar";
      };
    }

    empurrar(amostra) {
      this.buffer[this.usado++] = amostra;
      if (this.usado < this.tamanho) return;

      const pcm = new Int16Array(this.tamanho);
      let soma = 0;
      for (let i = 0; i < this.tamanho; i += 1) {
        const v = Math.max(-1, Math.min(1, this.buffer[i]));
        soma += v * v;
        // Assimétrico de propósito: -1 vale -32768 e +1 vale 32767.
        pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
      }
      this.usado = 0;

      // O nível do microfone sai daqui. Abrir um segundo getUserMedia só para
      // medir volume duplicaria a captura e atrapalharia o cancelamento de eco.
      this.port.postMessage({ pcm: pcm.buffer, rms: Math.sqrt(soma / this.tamanho) }, [pcm.buffer]);
    }

    process(entradas) {
      const canal = entradas[0] && entradas[0][0];
      if (!canal || !this.ligado) return true;

      if (this.razao === 1) {
        for (let i = 0; i < canal.length; i += 1) this.empurrar(canal[i]);
      } else {
        let p = this.fase;
        for (; p < canal.length; p += this.razao) {
          const i = p | 0;
          const f = p - i;
          const proxima = canal[i + 1] === undefined ? canal[i] : canal[i + 1];
          this.empurrar(canal[i] * (1 - f) + proxima * f);
        }
        // A fase sobra entre blocos: zerá-la aqui produziria um estalo a cada
        // 128 amostras, que é um clique constante e agudo.
        this.fase = p - canal.length;
      }
      return true;
    }
  }
);
