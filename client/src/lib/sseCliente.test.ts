import { describe, expect, it, vi } from "vitest";
import type { EventoJarvis } from "@shared/jarvisStream";
import { lerFluxoSse } from "./sseCliente";

/** Monta um fluxo a partir de pedaços de texto, como a rede entregaria. */
function fluxoDe(pedacos: string[]): ReadableStream<Uint8Array> {
  const codificador = new TextEncoder();
  return new ReadableStream({
    start(controlador) {
      for (const pedaco of pedacos) controlador.enqueue(codificador.encode(pedaco));
      controlador.close();
    },
  });
}

function quadro(evento: Partial<EventoJarvis> & { tipo: string }): string {
  return `id: ${(evento as any).seq ?? 1}\nevent: ${evento.tipo}\ndata: ${JSON.stringify(evento)}\n\n`;
}

describe("leitor de fluxo SSE", () => {
  it("entrega os eventos na ordem em que chegam", async () => {
    const recebidos: EventoJarvis[] = [];
    await lerFluxoSse(
      fluxoDe([
        quadro({ tipo: "pensando", seq: 1, em: 1, rodada: 1 } as any),
        quadro({ tipo: "narracao", seq: 2, em: 2, texto: "oi", origem: "modelo", rodada: 1 } as any),
      ]),
      (evento) => recebidos.push(evento)
    );

    expect(recebidos.map((e) => e.tipo)).toEqual(["pensando", "narracao"]);
  });

  it("remonta quadro partido no meio do JSON entre dois pedaços", async () => {
    // A rede não respeita fronteira de quadro: sem o acumulador, este caso
    // derrubaria o evento inteiro.
    const inteiro = quadro({
      tipo: "narracao",
      seq: 7,
      em: 1,
      texto: "vou procurar",
      origem: "modelo",
      rodada: 2,
    } as any);
    const corte = Math.floor(inteiro.length / 2);

    const recebidos: EventoJarvis[] = [];
    await lerFluxoSse(
      fluxoDe([inteiro.slice(0, corte), inteiro.slice(corte)]),
      (evento) => recebidos.push(evento)
    );

    expect(recebidos).toHaveLength(1);
    expect(recebidos[0]).toMatchObject({ tipo: "narracao", seq: 7 });
  });

  it("ignora o keep-alive sem invocar o callback", async () => {
    const aoEvento = vi.fn();
    await lerFluxoSse(
      fluxoDe([": ping\n\n", quadro({ tipo: "pensando", seq: 1, em: 1, rodada: 1 } as any)]),
      aoEvento
    );
    expect(aoEvento).toHaveBeenCalledTimes(1);
  });

  it("ignora o quadro de fim e não o entrega como evento", async () => {
    const aoEvento = vi.fn();
    await lerFluxoSse(fluxoDe(["event: fim\ndata: {}\n\n"]), aoEvento);
    expect(aoEvento).not.toHaveBeenCalled();
  });

  it("quadro corrompido não derruba o fluxo", async () => {
    const recebidos: EventoJarvis[] = [];
    await lerFluxoSse(
      fluxoDe([
        "event: narracao\ndata: {isso não é json}\n\n",
        quadro({ tipo: "pensando", seq: 2, em: 1, rodada: 1 } as any),
      ]),
      (evento) => recebidos.push(evento)
    );

    expect(recebidos).toHaveLength(1);
    expect(recebidos[0].tipo).toBe("pensando");
  });
});
