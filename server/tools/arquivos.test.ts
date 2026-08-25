import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { editarArquivo, escreverArquivo, lerArquivo } from "./arquivos";
import { invokeTool, type ContextoDeExecucao } from "./registry";

/**
 * As ferramentas de arquivo, contra disco de verdade.
 *
 * O que interessa aqui não é o caminho feliz: é o que acontece quando o trecho
 * procurado aparece duas vezes, quando o arquivo tem segredo dentro, e quando
 * sobrescrever apagaria trabalho.
 */

let pasta: string;

function contexto(overrides: Partial<ContextoDeExecucao> = {}): ContextoDeExecucao {
  return {
    execucaoId: "teste",
    acaoId: "acao",
    sinal: new AbortController().signal,
    emitir: () => {},
    interativo: false,
    autorizacoes: new Set(),
    perguntasFeitas: 0,
    prazoMs: 30_000,
    creditarEspera: () => {},
    ...overrides,
  } as ContextoDeExecucao;
}

beforeAll(() => {
  pasta = mkdtempSync(join(tmpdir(), "jarvis-arquivos-"));
});

describe("ler", () => {
  it("cria a pasta que falta em vez de reclamar", async () => {
    // Pedir para escrever num caminho que ainda não existe é pedido comum;
    // falhar por isso seria burocracia.
    const alvo = join(pasta, "nova", "sub", "nota.txt");
    const r = await escreverArquivo.execute({ caminho: alvo, conteudo: "oi", modo: "criar" }, contexto());
    expect(r.ok).toBe(true);
    expect(readFileSync(alvo, "utf8")).toBe("oi");
  });

  it("preserva acentos na ida e na volta", async () => {
    const alvo = join(pasta, "acentos.txt");
    await escreverArquivo.execute(
      { caminho: alvo, conteudo: "manutenção, ação, ãõ, çà", modo: "criar" },
      contexto()
    );
    const r = await lerArquivo.execute({ caminho: alvo }, contexto());
    expect(r.texto).toContain("manutenção, ação, ãõ, çà");
  });

  it("REDIGE segredo em vez de recusar o arquivo", async () => {
    // Recusar seria inútil: o dono precisa que ele leia o .env para conferir se
    // uma variável existe, sem que a chave vá para o provedor.
    const alvo = join(pasta, ".env");
    writeFileSync(alvo, "LLM_API_KEY=AIzaSyD-exemplo1234567890abcdefghijkl\nPORT=3000", "utf8");

    const r = await lerArquivo.execute({ caminho: alvo }, contexto());
    expect(r.ok).toBe(true);
    expect(r.texto).not.toContain("AIzaSyD-exemplo1234567890abcdefghijkl");
    expect(r.texto).toContain("segredo removido");
    // O nome da variável e o resto do arquivo continuam legíveis.
    expect(r.texto).toContain("LLM_API_KEY");
    expect(r.texto).toContain("PORT=3000");
  });

  it("recusa binário em vez de despejar lixo no contexto", async () => {
    const alvo = join(pasta, "dados.bin");
    writeFileSync(alvo, Buffer.from([0, 1, 2, 0, 4]));
    expect((await lerArquivo.execute({ caminho: alvo }, contexto())).ok).toBe(false);
  });

  it("lê uma faixa de linhas de arquivo grande", async () => {
    const alvo = join(pasta, "grande.txt");
    writeFileSync(alvo, Array.from({ length: 500 }, (_, i) => `linha ${i + 1}`).join("\n"), "utf8");

    const r = await lerArquivo.execute(
      { caminho: alvo, linha_inicial: 10, quantas_linhas: 3 },
      contexto()
    );
    expect(r.texto).toContain("linha 10");
    expect(r.texto).toContain("linha 12");
    expect(r.texto).not.toContain("linha 13");
  });

  it("arquivo inexistente e pasta são recusados com motivo claro", async () => {
    expect((await lerArquivo.execute({ caminho: join(pasta, "nada.txt") }, contexto())).ok).toBe(false);
    const r = await lerArquivo.execute({ caminho: pasta }, contexto());
    expect(r.ok).toBe(false);
    expect(r.texto).toContain("pasta");
  });
});

describe("editar", () => {
  it("troca o trecho e deixa o resto intacto", async () => {
    const alvo = join(pasta, "editar.txt");
    writeFileSync(alvo, "antes\nALVO\ndepois", "utf8");

    const r = await editarArquivo.execute(
      { caminho: alvo, procurar: "ALVO", substituir: "trocado" },
      contexto()
    );
    expect(r.ok).toBe(true);
    expect(readFileSync(alvo, "utf8")).toBe("antes\ntrocado\ndepois");
  });

  it("RECUSA trecho repetido em vez de trocar o primeiro", async () => {
    // Trocar "o primeiro que aparecer" acerta por sorte e erra em silêncio: o
    // arquivo fica alterado no lugar errado e ninguém percebe até quebrar.
    const alvo = join(pasta, "repetido.txt");
    writeFileSync(alvo, "igual\nigual", "utf8");

    const r = await editarArquivo.execute(
      { caminho: alvo, procurar: "igual", substituir: "novo" },
      contexto()
    );
    expect(r.ok).toBe(false);
    expect(r.texto).toContain("2 vezes");
    // E o arquivo continua exatamente como estava.
    expect(readFileSync(alvo, "utf8")).toBe("igual\nigual");
  });

  it("trecho ausente não altera nada", async () => {
    const alvo = join(pasta, "ausente.txt");
    writeFileSync(alvo, "conteudo", "utf8");
    const r = await editarArquivo.execute(
      { caminho: alvo, procurar: "inexistente", substituir: "x" },
      contexto()
    );
    expect(r.ok).toBe(false);
    expect(readFileSync(alvo, "utf8")).toBe("conteudo");
  });
});

describe("a trava de risco", () => {
  it("BLOQUEIA sobrescrever arquivo existente sem confirmação", async () => {
    // É a garantia que separa "assistente que escreve" de "assistente que apaga
    // trabalho". Sem canal para perguntar, a trava recusa em vez de presumir.
    const alvo = join(pasta, "precioso.txt");
    writeFileSync(alvo, "conteúdo que não pode sumir", "utf8");

    const resultado = await invokeTool(
      "escrever_arquivo",
      JSON.stringify({ caminho: alvo, conteudo: "novo", modo: "substituir" }),
      contexto()
    );

    expect(resultado.bloqueada).toBe(true);
    expect(readFileSync(alvo, "utf8")).toBe("conteúdo que não pode sumir");
  });

  it("criar arquivo NOVO passa direto, sem incomodar", async () => {
    // Não há nada a perder, e confirmar cada anotação transformaria a
    // ferramenta em estorvo.
    const alvo = join(pasta, "livre.txt");
    const resultado = await invokeTool(
      "escrever_arquivo",
      JSON.stringify({ caminho: alvo, conteudo: "anotação nova", modo: "criar" }),
      contexto()
    );

    expect(resultado.bloqueada).toBe(false);
    expect(resultado.ok).toBe(true);
  });

  it("acrescentar ao fim não é destrutivo e passa direto", async () => {
    const alvo = join(pasta, "diario.txt");
    writeFileSync(alvo, "primeiro dia", "utf8");

    const resultado = await invokeTool(
      "escrever_arquivo",
      JSON.stringify({ caminho: alvo, conteudo: "segundo dia", modo: "acrescentar" }),
      contexto()
    );

    expect(resultado.bloqueada).toBe(false);
    expect(readFileSync(alvo, "utf8")).toContain("primeiro dia");
    expect(readFileSync(alvo, "utf8")).toContain("segundo dia");
  });
});
