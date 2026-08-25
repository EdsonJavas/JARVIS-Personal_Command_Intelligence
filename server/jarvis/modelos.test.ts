import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  limparEsgotados,
  marcarEsgotado,
  modeloAtual,
  modelosDisponiveis,
  proximoModelo,
  saldoDeModelos,
} from "./modelos";

/**
 * O rodízio de modelos.
 *
 * O plano gratuito dá VINTE requisições por dia POR MODELO, e cada turno gasta
 * uma por rodada — umas sete conversas antes de o Jarvis emudecer. A palavra que
 * salva é "por modelo": a conta tem vários, cada um com sua cota. Isto é o que
 * transforma vinte em quase cem, sem cartão de crédito e sem o dono fazer nada.
 */

const original = { ...process.env };

beforeEach(() => limparEsgotados());

afterEach(() => {
  process.env.LLM_MODELS = original.LLM_MODELS;
  process.env.LLM_MODEL = original.LLM_MODEL;
  limparEsgotados();
});

describe("lista de modelos", () => {
  it("o ambiente sobrepõe a lista padrão", () => {
    process.env.LLM_MODELS = "um, dois ,tres";
    expect(modelosDisponiveis()).toEqual(["um", "dois", "tres"]);
  });

  it("LLM_MODEL sozinho vira o PRIMEIRO, sem perder o rodízio", () => {
    // Quem fixou um modelo quer aquele — mas continuar mudo quando ele esgota
    // não é o que essa pessoa queria dizer.
    delete process.env.LLM_MODELS;
    process.env.LLM_MODEL = "gemini-3.5-flash";
    const lista = modelosDisponiveis();
    expect(lista[0]).toBe("gemini-3.5-flash");
    expect(lista.length).toBeGreaterThan(1);
    // E não aparece duas vezes.
    expect(lista.filter((m) => m === "gemini-3.5-flash")).toHaveLength(1);
  });
});

describe("troca ao esgotar", () => {
  beforeEach(() => {
    process.env.LLM_MODELS = "a,b,c";
  });

  it("começa pelo primeiro", () => {
    expect(modeloAtual()).toBe("a");
  });

  it("pula o esgotado", () => {
    marcarEsgotado("a");
    expect(modeloAtual()).toBe("b");
  });

  it("o próximo respeita a ordem e ignora os esgotados", () => {
    expect(proximoModelo("a")).toBe("b");
    marcarEsgotado("b");
    expect(proximoModelo("a")).toBe("c");
  });

  it("sem próximo, devolve nulo em vez de dar a volta", () => {
    // Dar a volta faria o laço tentar de novo o que já esgotou, gastando tempo
    // do dono para receber o mesmo 429.
    marcarEsgotado("b");
    marcarEsgotado("c");
    expect(proximoModelo("a")).toBeNull();
  });

  it("com TODOS esgotados, ainda devolve um para tentar", () => {
    // Melhor tentar e receber o 429 — que traz o tempo de espera — do que
    // decidir aqui que não vale tentar: a cota pode ter renovado agora.
    marcarEsgotado("a");
    marcarEsgotado("b");
    marcarEsgotado("c");
    expect(modeloAtual()).toBe("a");
    expect(saldoDeModelos().livres).toBe(0);
  });

  it("marcar duas vezes não duplica", () => {
    marcarEsgotado("a");
    marcarEsgotado("a");
    expect(saldoDeModelos().esgotados).toEqual(["a"]);
  });

  it("o saldo conta certo", () => {
    marcarEsgotado("a");
    const s = saldoDeModelos();
    expect(s.total).toBe(3);
    expect(s.livres).toBe(2);
  });
});
