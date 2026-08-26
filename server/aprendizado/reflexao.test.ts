import { describe, expect, it } from "vitest";
import type { AcaoJarvis } from "@shared/jarvisStream";
import { refletir } from "./reflexao";

const acao = (name: string, ok: boolean, resumo = ""): AcaoJarvis => ({ name, ok, resumo, detail: "" });

describe("refletir sobre o turno", () => {
  it("correção do dono vira lição com o contexto do que foi corrigido", () => {
    const licoes = refletir([
      { role: "user", content: "abre o projeto" },
      { role: "assistant", content: "Abri o jarvis-web no Cursor, senhor." },
      { role: "user", content: "não, eu quis dizer o projeto da intellisys, no VS Code" },
    ]);

    expect(licoes).toHaveLength(1);
    expect(licoes[0].tipo).toBe("correcao");
    expect(licoes[0].conteudo).toContain("intellisys");
    expect(licoes[0].conteudo).toContain("Abri o jarvis-web");
  });

  it("preferência dita de passagem é guardada", () => {
    const licoes = refletir([
      { role: "user", content: "sempre me chame só de senhor, nunca pelo nome" },
    ]);
    expect(licoes).toHaveLength(1);
    expect(licoes[0].tipo).toBe("preferencia");
  });

  it("'não' no meio de uma pergunta comum NÃO é correção", () => {
    const licoes = refletir([
      { role: "assistant", content: "Pronto." },
      { role: "user", content: "o disco não está cheio, né? quanto sobrou?" },
    ]);
    expect(licoes).toEqual([]);
  });

  it("ferramenta que falhou e outra que resolveu viram um caminho", () => {
    const licoes = refletir(
      [{ role: "user", content: "acha o contrato" }],
      [
        acao("buscar_arquivos", false, "nada encontrado em Documents"),
        acao("executar_powershell", true, "C:\\Users\\x\\Downloads\\contrato.pdf"),
      ]
    );
    expect(licoes).toHaveLength(1);
    expect(licoes[0].conteudo).toContain("buscar_arquivos");
    expect(licoes[0].conteudo).toContain("executar_powershell");
  });

  it("falha sozinha, ou sucesso sozinho, não ensina nada", () => {
    expect(refletir([{ role: "user", content: "oi" }], [acao("x", false)])).toEqual([]);
    expect(refletir([{ role: "user", content: "oi" }], [acao("x", true)])).toEqual([]);
  });

  it("fala curta demais não vira memória", () => {
    expect(
      refletir([
        { role: "assistant", content: "Feito." },
        { role: "user", content: "não é" },
      ])
    ).toEqual([]);
  });
});
