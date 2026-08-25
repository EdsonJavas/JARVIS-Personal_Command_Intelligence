import { describe, expect, it, vi } from "vitest";
import { criarFilaDeFala, decidirFala, type EstadoDeFala } from "./filaDeFala";

const base: EstadoDeFala = {
  papel: "narracao",
  neuraisGastas: 0,
  maxNeurais: 2,
  narracaoFalada: "neural",
  vozLigada: true,
  cotaEstourada: false,
};

describe("decidir fala", () => {
  it("a primeira narração vai para a neural; passando do teto, silencia", () => {
    expect(decidirFala(base)).toBe("neural");
    expect(decidirFala({ ...base, neuraisGastas: 2 })).toBe("silencio");
  });

  it("a resposta final vai para a neural mesmo com a cota de narração gasta", () => {
    expect(decidirFala({ ...base, papel: "resposta", neuraisGastas: 9 })).toBe("neural");
  });

  it("pergunta é sempre falada e não depende da cota de narração", () => {
    // Uma confirmação na terceira rodada precisa ser ouvida: a execução fica
    // parada esperando a resposta.
    expect(decidirFala({ ...base, papel: "pergunta", neuraisGastas: 99 })).toBe("neural");
  });

  it("cota estourada degrada para a voz local em vez de tentar a neural de novo", () => {
    expect(decidirFala({ ...base, cotaEstourada: true })).toBe("local");
    expect(decidirFala({ ...base, papel: "resposta", cotaEstourada: true })).toBe("local");
    expect(decidirFala({ ...base, papel: "pergunta", cotaEstourada: true })).toBe("local");
  });

  it("voz desligada silencia tudo, inclusive pergunta", () => {
    expect(decidirFala({ ...base, vozLigada: false })).toBe("silencio");
    expect(decidirFala({ ...base, papel: "pergunta", vozLigada: false })).toBe("silencio");
    expect(decidirFala({ ...base, papel: "resposta", vozLigada: false })).toBe("silencio");
  });

  it("narração configurada como muda não fala, mas resposta continua falando", () => {
    expect(decidirFala({ ...base, narracaoFalada: "muda" })).toBe("silencio");
    expect(decidirFala({ ...base, papel: "resposta", narracaoFalada: "muda" })).toBe("neural");
  });
});

describe("fila de fala", () => {
  function montar(overrides: Partial<Parameters<typeof criarFilaDeFala>[0]> = {}) {
    const falarNeural = vi.fn().mockResolvedValue(undefined);
    const falarLocal = vi.fn();
    const pararFala = vi.fn();
    const fila = criarFilaDeFala({
      falarNeural,
      falarLocal,
      pararFala,
      vozLigada: () => true,
      ...overrides,
    });
    return { fila, falarNeural, falarLocal, pararFala };
  }

  it("respeita o teto de narrações neurais", async () => {
    const { fila, falarNeural } = montar({ maxNeurais: 2 });
    fila.narrar("uma");
    fila.narrar("duas");
    fila.narrar("três");
    // A fila é assíncrona de propósito: cada fala espera a anterior terminar.
    await vi.waitFor(() => expect(falarNeural).toHaveBeenCalledTimes(2));
    expect(falarNeural).toHaveBeenCalledTimes(2);
  });

  it("responder corta a fala em curso antes de falar", async () => {
    const { fila, pararFala, falarNeural } = montar();
    fila.responder("pronto");
    expect(pararFala).toHaveBeenCalled();
    await vi.waitFor(() => expect(falarNeural).toHaveBeenCalledWith("pronto", "resposta"));
  });

  it("uma narração só começa DEPOIS que a anterior terminou", async () => {
    // O defeito que motivou a fila: `speak` corta o áudio em curso, então
    // disparar sem esperar fazia a segunda frase atropelar a primeira no meio
    // da palavra. Em tarefa de dois passos, o dono nunca ouvia uma frase inteira.
    const emCurso: string[] = [];
    let concluir: (() => void) | null = null;

    const falarNeural = vi.fn((texto: string) => {
      emCurso.push(texto);
      return new Promise<void>((resolver) => {
        concluir = () => {
          emCurso.splice(emCurso.indexOf(texto), 1);
          resolver();
        };
      });
    });

    const { fila } = montar({ falarNeural, maxNeurais: 5 });
    fila.narrar("primeira");
    fila.narrar("segunda");

    await vi.waitFor(() => expect(falarNeural).toHaveBeenCalledTimes(1));
    // Nunca duas ao mesmo tempo.
    expect(emCurso).toEqual(["primeira"]);
    expect(falarNeural).not.toHaveBeenCalledWith("segunda", "narracao");

    concluir!();
    await vi.waitFor(() => expect(falarNeural).toHaveBeenCalledWith("segunda", "narracao"));
    expect(emCurso).toEqual(["segunda"]);
  });

  it("resposta descarta a narração que ainda não saiu", async () => {
    // Falar "vou procurar" depois da resposta pronta seria incoerente.
    let concluirPrimeira: (() => void) | null = null;
    const falarNeural = vi.fn((texto: string) =>
      texto === "primeira"
        ? new Promise<void>((resolver) => {
            concluirPrimeira = resolver;
          })
        : Promise.resolve()
    );

    const { fila, pararFala } = montar({ falarNeural, maxNeurais: 5 });
    fila.narrar("primeira");
    await vi.waitFor(() => expect(falarNeural).toHaveBeenCalledWith("primeira", "narracao"));

    fila.narrar("segunda");
    fila.narrar("terceira");
    fila.responder("pronto, Senhor");

    expect(pararFala).toHaveBeenCalled();
    concluirPrimeira!();

    await vi.waitFor(() => expect(falarNeural).toHaveBeenCalledWith("pronto, Senhor", "resposta"));
    expect(falarNeural).not.toHaveBeenCalledWith("segunda", "narracao");
    expect(falarNeural).not.toHaveBeenCalledWith("terceira", "narracao");
  });

  it("falha na neural cai para a local e não insiste na neural depois", async () => {
    const falarNeural = vi.fn().mockRejectedValue(new Error("429"));
    const { fila, falarLocal } = montar({ falarNeural, maxNeurais: 5 });

    fila.narrar("primeira");
    await vi.waitFor(() => expect(falarLocal).toHaveBeenCalledWith("primeira"));

    fila.narrar("segunda");
    await vi.waitFor(() => expect(falarLocal).toHaveBeenCalledWith("segunda"));
    // Uma tentativa só na neural: sem isto, cada frase geraria um 429.
    expect(falarNeural).toHaveBeenCalledTimes(1);
  });

  it("texto vazio não gera fala", () => {
    const { fila, falarNeural, falarLocal } = montar();
    fila.narrar("   ");
    expect(falarNeural).not.toHaveBeenCalled();
    expect(falarLocal).not.toHaveBeenCalled();
  });

  it("encerrada, a fila para de falar", async () => {
    const { fila, falarNeural, pararFala } = montar();
    fila.encerrar();
    fila.responder("tarde demais");
    expect(pararFala).toHaveBeenCalled();
    await vi.waitFor(() => expect(falarNeural).not.toHaveBeenCalled());
  });
});

describe("voz local neural manda", () => {
  const base: EstadoDeFala = {
    papel: "narracao",
    neuraisGastas: 0,
    maxNeurais: 2,
    narracaoFalada: "neural",
    vozLigada: true,
    cotaEstourada: false,
    vozLocalEhNatural: true,
  };

  it("com voz neural do navegador, TUDO é falado localmente", () => {
    // Ela é instantânea e ilimitada, contra 2 a 7 segundos e dez requisições por
    // dia da síntese do Gemini. Preferir a remota aqui seria piorar de propósito.
    expect(decidirFala(base)).toBe("local");
    expect(decidirFala({ ...base, papel: "resposta" })).toBe("local");
    expect(decidirFala({ ...base, papel: "pergunta" })).toBe("local");
  });

  it("o teto de falas neurais deixa de importar", () => {
    // Sem isto, a décima narração de uma tarefa longa ficaria muda à toa.
    expect(decidirFala({ ...base, neuraisGastas: 99 })).toBe("local");
  });

  it("narração desligada continua muda", () => {
    expect(decidirFala({ ...base, narracaoFalada: "muda" })).toBe("silencio");
    // Mas a resposta, não: desligar narração não é desligar a voz.
    expect(decidirFala({ ...base, papel: "resposta", narracaoFalada: "muda" })).toBe("local");
  });

  it("voz desligada pelo dono vence tudo", () => {
    expect(decidirFala({ ...base, vozLigada: false })).toBe("silencio");
  });

  it("sem voz neural local, a política antiga continua valendo", () => {
    const antiga = { ...base, vozLocalEhNatural: false };
    expect(decidirFala({ ...antiga, papel: "resposta" })).toBe("neural");
    expect(decidirFala({ ...antiga, neuraisGastas: 99 })).toBe("silencio");
  });
});

describe("voz do servidor manda em todas", () => {
  const base: EstadoDeFala = {
    papel: "narracao",
    neuraisGastas: 99,
    maxNeurais: 2,
    narracaoFalada: "neural",
    vozLigada: true,
    cotaEstourada: true,
    vozLocalEhNatural: true,
    vozDoServidor: true,
  };

  it("com voz na máquina, tudo é falado por ela", () => {
    // Ilimitada, offline e igual em qualquer navegador — nem o teto de falas nem
    // a cota estourada do provedor remoto importam aqui.
    expect(decidirFala(base)).toBe("neural");
    expect(decidirFala({ ...base, papel: "resposta" })).toBe("neural");
    expect(decidirFala({ ...base, papel: "pergunta" })).toBe("neural");
  });

  it("ganha até da voz neural do navegador", () => {
    // Não é preferência estética: depender do navegador foi justamente o que o
    // dono recusou.
    expect(decidirFala({ ...base, vozLocalEhNatural: true })).toBe("neural");
  });

  it("narração desligada continua muda", () => {
    expect(decidirFala({ ...base, narracaoFalada: "muda" })).toBe("silencio");
  });

  it("voz desligada pelo dono vence tudo", () => {
    expect(decidirFala({ ...base, vozLigada: false })).toBe("silencio");
  });
});
