import { describe, expect, it } from "vitest";
import {
  dataPorExtenso,
  descreverRotina,
  descreverVigia,
  filtrarMemorias,
  quandoFalta,
  saudacao,
  separarCompromissos,
} from "./miniSistema";

/** Segunda-feira, 16 de novembro de 2026, 17h42, no fuso da máquina. */
const AGORA = new Date(2026, 10, 16, 17, 42);

describe("saudacao", () => {
  it("segue o relógio", () => {
    expect(saudacao(new Date(2026, 10, 16, 6, 0))).toBe("Bom dia");
    expect(saudacao(new Date(2026, 10, 16, 11, 59))).toBe("Bom dia");
    expect(saudacao(new Date(2026, 10, 16, 12, 0))).toBe("Boa tarde");
    expect(saudacao(new Date(2026, 10, 16, 18, 0))).toBe("Boa noite");
    expect(saudacao(new Date(2026, 10, 16, 2, 0))).toBe("Boa noite");
  });
});

describe("dataPorExtenso", () => {
  it("dia da semana e dia do mês, sem o ano", () => {
    expect(dataPorExtenso(AGORA)).toBe("segunda-feira, 16 de novembro");
  });
});

describe("quandoFalta", () => {
  const em = (minutos: number) => new Date(AGORA.getTime() + minutos * 60_000).toISOString();

  it("perto: em minutos", () => {
    expect(quandoFalta(em(25), AGORA)).toBe("em 25 min");
    expect(quandoFalta(em(0.5), AGORA)).toBe("agora");
  });

  it("hoje ainda: em horas e o horário", () => {
    expect(quandoFalta(em(150), AGORA)).toBe("hoje às 20:12");
  });

  it("amanhã e depois", () => {
    expect(quandoFalta(new Date(2026, 10, 17, 9, 0).toISOString(), AGORA)).toBe("amanhã às 09:00");
    expect(quandoFalta(new Date(2026, 10, 20, 9, 30).toISOString(), AGORA)).toBe("sex, 20/11 às 09:30");
  });

  it("passado é atrasado; sem data é sem data", () => {
    expect(quandoFalta(em(-10), AGORA)).toBe("atrasado");
    expect(quandoFalta(null, AGORA)).toBe("sem data");
  });
});

describe("descreverRotina", () => {
  it("todo dia, dias úteis, fim de semana e dias soltos", () => {
    expect(descreverRotina(8 * 60, null)).toBe("todo dia às 08:00");
    expect(descreverRotina(18 * 60 + 30, "1,2,3,4,5")).toBe("dias úteis às 18:30");
    expect(descreverRotina(10 * 60, "0,6")).toBe("fins de semana às 10:00");
    expect(descreverRotina(7 * 60, "1,3,5")).toBe("seg, qua e sex às 07:00");
    expect(descreverRotina(7 * 60, "2")).toBe("ter às 07:00");
  });

  it("sem horário não inventa", () => {
    expect(descreverRotina(null, null)).toBe("sem horário");
  });
});

describe("descreverVigia", () => {
  it("diz o que vigia e o limite", () => {
    expect(descreverVigia("cpu", "acima", 90)).toBe("CPU acima de 90%");
    expect(descreverVigia("disco", "abaixo", 10)).toBe("disco abaixo de 10%");
    expect(descreverVigia(null, null, null)).toBe("vigia");
  });
});

describe("separarCompromissos", () => {
  it("separa por tipo, mantendo a ordem do servidor", () => {
    const lista = [
      { id: 1, tipo: "rotina" as const },
      { id: 2, tipo: "lembrete" as const },
      { id: 3, tipo: "vigia" as const },
      { id: 4, tipo: "lembrete" as const },
    ];
    const separado = separarCompromissos(lista);
    expect(separado.lembretes.map((c) => c.id)).toEqual([2, 4]);
    expect(separado.rotinas.map((c) => c.id)).toEqual([1]);
    expect(separado.vigias.map((c) => c.id)).toEqual([3]);
  });
});

describe("filtrarMemorias", () => {
  const memorias = [
    { id: 1, conteudo: "Mora em Salvador", esquecida: false },
    { id: 2, conteudo: "Prefere respostas curtas", esquecida: false },
    { id: 3, conteudo: "Usa o Cursor", esquecida: true },
  ];

  it("sem busca, só as que valem", () => {
    expect(filtrarMemorias(memorias, "").ativas.map((m) => m.id)).toEqual([1, 2]);
    expect(filtrarMemorias(memorias, "").esquecidas.map((m) => m.id)).toEqual([3]);
  });

  it("a busca ignora acento e caixa", () => {
    expect(filtrarMemorias(memorias, "SALVADÓR").ativas.map((m) => m.id)).toEqual([1]);
    expect(filtrarMemorias(memorias, "cursor").esquecidas.map((m) => m.id)).toEqual([3]);
  });
});
