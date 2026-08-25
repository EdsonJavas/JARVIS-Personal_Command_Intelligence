import { describe, expect, it } from "vitest";
import { descreverQuando, extrairHorario, interpretarQuando } from "./quando";

/** Quarta-feira, 19 de agosto de 2026, 14h30. Todo teste parte daqui. */
const AGORA = new Date(2026, 7, 19, 14, 30, 0, 0);

function resolver(expressao: string, agora = AGORA) {
  const r = interpretarQuando(expressao, agora);
  if (!r.ok) throw new Error(`não interpretou "${expressao}": ${r.motivo}`);
  return r.quando;
}

describe("extrair horário", () => {
  it.each([
    ["às 15h", 15 * 60],
    ["15:30", 15 * 60 + 30],
    ["15h30", 15 * 60 + 30],
    ["meio-dia", 12 * 60],
    ["meia-noite", 0],
  ])("%s", (texto, esperado) => {
    expect(extrairHorario(texto)).toBe(esperado);
  });

  it("'da noite' desloca para a tarde", () => {
    // Sem isto, "me lembre às 8 da noite" viraria 8h da manhã: doze horas de
    // erro, descoberto só quando o lembrete não tocasse.
    expect(extrairHorario("às 8 da noite")).toBe(20 * 60);
    expect(extrairHorario("às 8 da manhã")).toBe(8 * 60);
  });

  it("sem horário no texto, devolve nulo", () => {
    expect(extrairHorario("amanhã")).toBeNull();
  });
});

describe("interpretar quando", () => {
  it("duração relativa", () => {
    expect(resolver("em 20 minutos").getTime()).toBe(AGORA.getTime() + 20 * 60_000);
    expect(resolver("daqui a 2 horas").getHours()).toBe(16);
    expect(resolver("dentro de 3 dias").getDate()).toBe(22);
  });

  it("amanhã, com e sem horário", () => {
    const comHora = resolver("amanhã às 15h");
    expect(comHora.getDate()).toBe(20);
    expect(comHora.getHours()).toBe(15);

    // Sem horário dito, 9h é um padrão defensável para um lembrete de dia.
    expect(resolver("amanhã").getHours()).toBe(9);
  });

  it("depois de amanhã não é confundido com amanhã", () => {
    expect(resolver("depois de amanhã às 10h").getDate()).toBe(21);
  });

  it("horário de hoje que já passou vira amanhã", () => {
    // Pedir "às 8h" às 14h30 não é pedir um lembrete para seis horas atrás.
    const r = resolver("às 8h");
    expect(r.getDate()).toBe(20);
    expect(r.getHours()).toBe(8);
  });

  it("horário de hoje ainda por vir fica hoje", () => {
    const r = resolver("às 18h");
    expect(r.getDate()).toBe(19);
    expect(r.getHours()).toBe(18);
  });

  it("dia da semana pega o próximo", () => {
    // Quarta pedindo "sexta" são dois dias.
    expect(resolver("na sexta às 9h").getDate()).toBe(21);
  });

  it("o mesmo dia da semana significa a semana que vem", () => {
    // Quarta pedindo "quarta" é daqui a sete dias, não agora.
    expect(resolver("quarta às 9h").getDate()).toBe(26);
  });

  it("data com barra e por extenso", () => {
    const barra = resolver("dia 25/12 às 20h");
    expect(barra.getMonth()).toBe(11);
    expect(barra.getDate()).toBe(25);

    const extenso = resolver("3 de setembro às 8h");
    expect(extenso.getMonth()).toBe(8);
    expect(extenso.getDate()).toBe(3);
  });

  it("data já passada sem ano dito cai no ano que vem", () => {
    // "dia 3 de janeiro", dito em agosto, não é um lembrete para sete meses atrás.
    const r = resolver("3 de janeiro às 9h");
    expect(r.getFullYear()).toBe(2027);
  });

  it("aceita ISO pronto, que é o caminho preferido", () => {
    const r = resolver("2026-12-25T20:00:00");
    expect(r.getMonth()).toBe(11);
    expect(r.getDate()).toBe(25);
  });

  it("RECUSA instante no passado em vez de agendar para trás", () => {
    // Aceitar calado criaria um lembrete que dispara na hora seguinte à criação,
    // ou nunca — e o dono acharia que estava marcado.
    expect(interpretarQuando("2020-01-01T10:00:00", AGORA).ok).toBe(false);
  });

  it("recusa o que não entende, em vez de chutar", () => {
    const r = interpretarQuando("qualquer coisa sem tempo nenhum", AGORA);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain("não entendi");
  });

  it("expressão vazia é recusada", () => {
    expect(interpretarQuando("", AGORA).ok).toBe(false);
    expect(interpretarQuando("   ", AGORA).ok).toBe(false);
  });
});

describe("descrever quando", () => {
  it("fala como gente", () => {
    expect(descreverQuando(new Date(2026, 7, 19, 14, 50), AGORA)).toBe("em 20 minutos");
    expect(descreverQuando(new Date(2026, 7, 19, 18, 0), AGORA)).toBe("hoje às 18:00");
    expect(descreverQuando(new Date(2026, 7, 20, 9, 0), AGORA)).toContain("amanhã às 09:00");
  });

  it("data distante ganha dia da semana", () => {
    expect(descreverQuando(new Date(2026, 7, 25, 9, 0), AGORA)).toContain("terça");
  });
});
