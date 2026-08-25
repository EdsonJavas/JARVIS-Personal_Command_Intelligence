import { describe, expect, it } from "vitest";
import type { AcaoJarvis, MensagemDeFio } from "@shared/jarvisStream";
import {
  comRecapitulacao,
  montarRecapitulacao,
  resumirSaida,
  saidaIndicaFalha,
  TETO_DE_RECAPITULACAO,
} from "./recapitulacao";

describe("resumir saída", () => {
  it("pula cabeçalho e régua do Format-Table e devolve o fato", () => {
    // Nove ferramentas terminam em Format-Table. "A primeira linha não vazia"
    // seria o cabeçalho de colunas, não o resultado.
    const saida = `
TamanhoMB Modificado FullName
--------- ---------- --------
     8,42 15/08/2026 C:\\Users\\es553\\video.mp4
`;
    const resumo = resumirSaida(saida, true);
    expect(resumo).not.toContain("TamanhoMB");
    expect(resumo).toContain("video.mp4");
  });

  it("saída sem tabela devolve a própria linha", () => {
    expect(resumirSaida("Processo notepad encerrado.", true)).toBe("Processo notepad encerrado.");
  });

  it("saída vazia é descrita conforme o desfecho", () => {
    expect(resumirSaida("", true)).toBe("sem saída");
    expect(resumirSaida("", false)).toBe("falhou sem mensagem");
  });

  it("respeita o limite de tamanho com reticência", () => {
    const resumo = resumirSaida("x".repeat(400), true, 50);
    expect(resumo.length).toBeLessThanOrEqual(50);
    expect(resumo.endsWith("…")).toBe(true);
  });
});

describe("falha embutida em saída de sucesso", () => {
  it("reconhece acesso negado e caminho inexistente nos dois idiomas", () => {
    expect(saidaIndicaFalha("Access is denied")).toBe(true);
    expect(saidaIndicaFalha("Acesso negado ao diretório")).toBe(true);
    expect(saidaIndicaFalha("ObjectNotFound: (x:String)")).toBe(true);
    expect(saidaIndicaFalha("Cannot find path 'C:\\x'")).toBe(true);
  });

  it("não acusa falha em saída legítima", () => {
    expect(saidaIndicaFalha("3 arquivos encontrados")).toBe(false);
    expect(saidaIndicaFalha("")).toBe(false);
  });
});

describe("recapitulação", () => {
  const acao = (nome: string, resumo: string, ok = true): AcaoJarvis => ({
    name: nome,
    detail: `detalhe de ${nome}`,
    ok,
    resumo,
  });

  it("monta o bloco com nome, detalhe e resultado", () => {
    const bloco = montarRecapitulacao([acao("listar_pasta", "12 itens")]);
    expect(bloco).toContain("listar_pasta");
    expect(bloco).toContain("12 itens");
  });

  it("marca a ação que falhou", () => {
    const bloco = montarRecapitulacao([acao("encerrar_processo", "acesso negado", false)]);
    expect(bloco).toContain("FALHOU");
  });

  it("lista vazia não produz bloco", () => {
    expect(montarRecapitulacao([])).toBe("");
    expect(montarRecapitulacao(undefined)).toBe("");
  });

  it("respeita o teto preservando as ações mais recentes", () => {
    const muitas = Array.from({ length: 40 }, (_, i) => acao(`ferramenta_${i}`, "x".repeat(80)));
    const bloco = montarRecapitulacao(muitas);

    expect(bloco.length).toBeLessThanOrEqual(TETO_DE_RECAPITULACAO + 60);
    // Sob pressão de espaço, o recente é o que importa.
    expect(bloco).toContain("ferramenta_39");
    expect(bloco).not.toContain("ferramenta_0(");
  });

  it("aplicada duas vezes não duplica o bloco", () => {
    // O cliente reenvia o histórico a cada turno: sem idempotência o bloco
    // cresceria até estourar o limite de tamanho da mensagem.
    const mensagem: MensagemDeFio = {
      role: "assistant",
      content: "Trinta e sete, senhor.",
      acoes: [acao("executar_powershell", "37")],
    };

    const uma = comRecapitulacao(mensagem);
    const duas = comRecapitulacao({ ...mensagem, content: uma });
    expect(duas).toBe(uma);
  });

  it("mensagem do usuário nunca recebe recapitulação", () => {
    const mensagem: MensagemDeFio = {
      role: "user",
      content: "quantos arquivos?",
      acoes: [acao("x", "y")],
    };
    expect(comRecapitulacao(mensagem)).toBe("quantos arquivos?");
  });
});
