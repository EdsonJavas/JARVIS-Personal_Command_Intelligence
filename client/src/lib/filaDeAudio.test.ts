import { beforeEach, describe, expect, it, vi } from "vitest";
import { criarFilaDeAudio } from "./filaDeAudio";

/**
 * O que se verifica aqui é o AGENDAMENTO, que é onde mora o estalo.
 *
 * Um `AudioContext` falso basta: o Web Audio real não roda em Node, e o que
 * importa não é o som — é em que instante cada bloco foi marcado para começar.
 */

type FonteFalsa = { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
const fontes: FonteFalsa[] = [];
let relogio = 0;

function contextoFalso() {
  return {
    get currentTime() {
      return relogio;
    },
    createGain: () => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
      gain: {
        cancelScheduledValues: vi.fn(),
        setTargetAtTime: vi.fn(),
        setValueAtTime: vi.fn(),
      },
    }),
    createBuffer: (_c: number, n: number, taxa: number) => ({
      duration: n / taxa,
      getChannelData: () => new Float32Array(n),
    }),
    createBufferSource: () => {
      const f: FonteFalsa & { connect: unknown; onended: unknown; buffer: unknown } = {
        start: vi.fn(),
        stop: vi.fn(),
        connect: vi.fn(),
        onended: null,
        buffer: null,
      };
      fontes.push(f);
      return f;
    },
  } as unknown as AudioContext;
}

beforeEach(() => {
  fontes.length = 0;
  relogio = 0;
});

/** Meio segundo de áudio a 24 kHz. */
const bloco = (amostras = 12_000) => new Int16Array(amostras);

describe("fila de áudio ao vivo", () => {
  it("agenda cada bloco no instante EXATO em que o anterior termina", () => {
    const fila = criarFilaDeAudio(contextoFalso(), {} as AudioNode);

    fila.enfileirar(bloco());
    fila.enfileirar(bloco());
    fila.enfileirar(bloco());

    const inicios = fontes.map((f) => f.start.mock.calls[0][0] as number);
    // Nunca `start()` sem argumento — é isso que produz o buraco entre blocos.
    expect(fontes.every((f) => f.start.mock.calls[0].length === 1)).toBe(true);
    // Meio segundo de duração, então os inícios são contíguos.
    expect(inicios[1] - inicios[0]).toBeCloseTo(0.5, 5);
    expect(inicios[2] - inicios[1]).toBeCloseTo(0.5, 5);
  });

  it("o primeiro bloco leva um colchão contra a variação da rede", () => {
    const fila = criarFilaDeAudio(contextoFalso(), {} as AudioNode);
    relogio = 10;
    fila.enfileirar(bloco());

    expect(fontes[0].start.mock.calls[0][0]).toBeGreaterThan(10);
  });

  it("bloco atrasado alarga o colchão, para o próximo trecho não repetir a falha", () => {
    const fila = criarFilaDeAudio(contextoFalso(), {} as AudioNode);
    fila.enfileirar(bloco());
    const primeiroColchao = (fontes[0].start.mock.calls[0][0] as number) - 0;

    // O relógio andou muito além do fim do primeiro bloco: a fila secou.
    relogio = 99;
    fila.enfileirar(bloco());
    const segundoColchao = (fontes[1].start.mock.calls[0][0] as number) - 99;

    expect(segundoColchao).toBeGreaterThan(primeiroColchao);
  });

  it("descartar corta o que estava agendado — é o barge-in", () => {
    const fila = criarFilaDeAudio(contextoFalso(), {} as AudioNode);
    fila.enfileirar(bloco());
    fila.enfileirar(bloco());

    fila.descartar();

    expect(fontes.every((f) => f.stop.mock.calls.length === 1)).toBe(true);
    // Com rampa curta, não corte seco: parar no meio do ciclo estala.
    expect(fontes[0].stop.mock.calls[0][0]).toBeGreaterThan(0);
    expect(fila.tocando()).toBe(false);
  });

  it("bloco vazio não vira fonte", () => {
    const fila = criarFilaDeAudio(contextoFalso(), {} as AudioNode);
    fila.enfileirar(new Int16Array(0));
    expect(fontes).toHaveLength(0);
  });
});
