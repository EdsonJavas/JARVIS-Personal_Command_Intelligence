import { describe, expect, it } from "vitest";
import { selecionarFerramentas } from "./selecaoDeFerramentas";

/**
 * A escolha do que vai no pedido.
 *
 * Existe por um número medido: o catálogo inteiro são 60 KB de esquema em CADA
 * rodada, e levava uma saudação a 131 SEGUNDOS. Só a agenda são 33 KB, e um
 * único `create-event` tem 9,8 KB — peso que viajava mesmo quando o dono só
 * perguntou como estava a máquina.
 */

const TUDO = [
  "estado_da_maquina",
  "ler_arquivo",
  "perguntar_ao_usuario",
  "agenda_list-events",
  "agenda_create-event",
  "email_send_email",
  "email_search_emails",
];

const nomes = (pedido: string, jaUsadas: string[] = []) =>
  selecionarFerramentas({ disponiveis: TUDO, pedido, jaUsadas });

describe("seleção de ferramentas", () => {
  it("as nativas entram sempre", () => {
    const escolhidas = nomes("olá, tudo bem?");
    expect(escolhidas).toContain("estado_da_maquina");
    expect(escolhidas).toContain("ler_arquivo");
    expect(escolhidas).toContain("perguntar_ao_usuario");
  });

  it("uma saudação NÃO carrega agenda nem e-mail", () => {
    // É o caso que custava dois minutos.
    const escolhidas = nomes("olá, tudo bem?");
    expect(escolhidas.some((n) => n.startsWith("agenda_"))).toBe(false);
    expect(escolhidas.some((n) => n.startsWith("email_"))).toBe(false);
  });

  it.each([
    ["o que tenho na agenda hoje?", "agenda_"],
    ["marque uma reunião amanhã", "agenda_"],
    ["estou livre na quinta?", "agenda_"],
    ["tem email novo?", "email_"],
    ["responda essa mensagem", "email_"],
    ["procura na caixa de entrada", "email_"],
  ])("'%s' traz o grupo %s", (pedido, prefixo) => {
    expect(nomes(pedido).some((n) => n.startsWith(prefixo))).toBe(true);
  });

  it("casa com e sem acento", () => {
    // O ditado por voz chega sem acento com frequência.
    expect(nomes("tenho reuniao amanha?").some((n) => n.startsWith("agenda_"))).toBe(true);
    expect(nomes("tenho reunião amanhã?").some((n) => n.startsWith("agenda_"))).toBe(true);
  });

  it("grupo já usado CONTINUA disponível nas rodadas seguintes", () => {
    // Sem isto, a segunda rodada perderia justamente a ferramenta que o modelo
    // acabou de usar, e ele desistiria no meio da tarefa.
    const escolhidas = nomes("faça aquilo que combinamos", ["agenda_list-events"]);
    expect(escolhidas).toContain("agenda_create-event");
  });

  it("pedido vazio não quebra e devolve as nativas", () => {
    const escolhidas = nomes("");
    expect(escolhidas.length).toBeGreaterThan(0);
    expect(escolhidas.some((n) => n.startsWith("agenda_"))).toBe(false);
  });
});

describe("as frases que falhavam de verdade", () => {
  const nativas = ["estado_da_maquina", "buscar_na_web"];
  const externas = ["agenda_list-events", "email_search_emails", "github_search_code"];
  const escolher = (pedido: string, jaUsadas: string[] = []) =>
    selecionarFerramentas({ disponiveis: [...nativas, ...externas], pedido, jaUsadas });

  it.each([
    ["responde pro cliente", "email_"],
    ["tem alguma coisa marcada pra sexta?", "agenda_"],
    ["o que eu tenho amanhã?", "agenda_"],
    ["o que tá pendente no jarvis-web?", "github_"],
    ["encaminha aquele anexo", "email_"],
    ["minha semana está cheia?", "agenda_"],
  ])("%s → %s", (pedido, prefixo) => {
    expect(escolher(pedido).some((n) => n.startsWith(prefixo))).toBe(true);
  });

  it("o grupo sobrevive ao turno: 'e amanhã?' mantém a agenda", () => {
    // Sem contexto, "e amanhã?" traz agenda pelo gatilho próprio.
    // O que este teste prova é o caso sem gatilho nenhum:
    expect(escolher("e o segundo?").some((n) => n.startsWith("agenda_"))).toBe(false);
    expect(
      escolher("e o segundo?", ["agenda_list-events"]).some((n) => n.startsWith("agenda_"))
    ).toBe(true);
  });

  it("habilitar_grupo destrava pelo prefixo puro", () => {
    expect(escolher("acha aquilo", ["agenda_"]).some((n) => n.startsWith("agenda_"))).toBe(true);
  });

  it("REGRESSÃO: saudação não traz grupo externo — foi o caso dos 131 s", () => {
    for (const oi of ["olá, tudo bem?", "oi", "bom dia"]) {
      expect(escolher(oi)).toEqual(nativas);
    }
  });

  it("'me manda uma mensagem' não é e-mail", () => {
    expect(escolher("me manda uma mensagem").some((n) => n.startsWith("email_"))).toBe(false);
  });
});
