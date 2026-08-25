import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Testes do repositório contra um SQLite de verdade, em arquivo temporário.
 *
 * Contra mock não teriam valor: os defeitos que apareceram aqui foram todos de
 * integração — migração não esperada, identidade da memória, e um update cujo
 * retorno era sempre verdadeiro. Nenhum deles existe fora do banco real.
 *
 * O import é dinâmico porque `DATABASE_URL` precisa estar no ambiente ANTES do
 * módulo de configuração ser avaliado, e `import` estático é içado para o topo.
 */

type Repositorio = typeof import("./repositorio");

let repo: Repositorio;
let pasta: string;

beforeAll(async () => {
  pasta = mkdtempSync(join(tmpdir(), "jarvis-memoria-"));
  process.env.DATABASE_URL = join(pasta, "teste.db");
  repo = await import("./repositorio");
});

afterAll(() => {
  // Melhor esforço: no Windows o SQLite ainda segura o arquivo quando o teste
  // termina, e falhar aqui reprovaria uma suíte que passou. O diretório é único
  // por execução e fica na pasta temporária do sistema.
  try {
    rmSync(pasta, { recursive: true, force: true });
  } catch {
    /* o sistema recolhe depois */
  }
});

describe("lembrar", () => {
  it("grava um fato novo em banco limpo", async () => {
    // Cobre a falha real: o repositório não esperava as migrações, então a
    // PRIMEIRA gravação numa máquina nova morria com "no such table".
    const resultado = await repo.lembrar({ conteudo: "O Edson mora em Marília, São Paulo." });

    expect(resultado.estado).toBe("criada");
    if (resultado.estado !== "criada") return;
    expect(resultado.memoria.conteudo).toContain("Marília");
    expect(resultado.memoria.versao).toBe(1);
  });

  it("o mesmo assunto dito com mais palavras ATUALIZA, não duplica", async () => {
    // "Marília, São Paulo" e "Marília, interior de São Paulo" geravam chaves
    // diferentes por uma palavra, e sobravam duas memórias contraditórias.
    const resultado = await repo.lembrar({
      conteudo: "O Edson mora em Marília, interior de São Paulo.",
    });

    expect(resultado.estado).toBe("atualizada");
    if (resultado.estado !== "atualizada") return;
    expect(resultado.anterior).toContain("Marília, São Paulo");
    expect(resultado.memoria.versao).toBe(2);

    const todas = await repo.listarMemorias();
    expect(todas.filter((memoria) => memoria.conteudo.includes("Marília"))).toHaveLength(1);
  });

  it("guarda a versão anterior no histórico antes de sobrescrever", async () => {
    const todas = await repo.listarMemorias();
    const daCidade = todas.find((memoria) => memoria.conteudo.includes("Marília"))!;

    const historico = await repo.historicoDe(daCidade.id);
    expect(historico.length).toBeGreaterThan(0);
    expect(historico[0].conteudo).toContain("Marília, São Paulo");
  });

  it("dedução NÃO sobrescreve o que o dono afirmou", async () => {
    const resultado = await repo.lembrar({
      conteudo: "O Edson mora em Marília, no estado de São Paulo.",
      origem: "inferida",
    });

    expect(resultado.estado).toBe("parecida");
    const todas = await repo.listarMemorias();
    const daCidade = todas.find((memoria) => memoria.conteudo.includes("Marília"))!;
    expect(daCidade.conteudo).toContain("interior");
  });

  it("recusa segredo antes de tocar o banco", async () => {
    const resultado = await repo.lembrar({
      conteudo: "a chave da API é sk-proj-Ab3xK9zQmN2pLr7TvW4yH8jF6dS1gC5eU0iO",
    });

    expect(resultado.estado).toBe("bloqueada");
    const todas = await repo.listarMemorias(true);
    expect(todas.some((memoria) => memoria.conteudo.includes("sk-proj"))).toBe(false);
  });

  it("recusa conteúdo vazio", async () => {
    expect((await repo.lembrar({ conteudo: "   " })).estado).toBe("bloqueada");
  });
});

describe("esquecer e restaurar", () => {
  it("esquecer some da lista mas a linha continua existindo", async () => {
    const criada = await repo.lembrar({ conteudo: "O prazo do contrato vence em novembro." });
    if (criada.estado !== "criada") throw new Error("esperava memória nova");

    expect(await repo.esquecer(criada.memoria.id)).toBe(true);

    const visiveis = await repo.listarMemorias();
    const todas = await repo.listarMemorias(true);
    expect(visiveis.some((memoria) => memoria.id === criada.memoria.id)).toBe(false);
    expect(todas.some((memoria) => memoria.id === criada.memoria.id)).toBe(true);
  });

  it("restaurar traz de volta", async () => {
    const todas = await repo.listarMemorias(true);
    const esquecida = todas.find((memoria) => memoria.esquecida)!;

    expect(await repo.restaurar(esquecida.id)).toBe(true);
    const visiveis = await repo.listarMemorias();
    expect(visiveis.some((memoria) => memoria.id === esquecida.id)).toBe(true);
  });

  it("restaurar o que não está esquecido devolve false", async () => {
    // O update do Drizzle devolve objeto mesmo sem casar linha nenhuma, então
    // `Boolean(resultado)` dizia ter restaurado o que nunca foi esquecido.
    const [viva] = await repo.listarMemorias();
    expect(await repo.restaurar(viva.id)).toBe(false);
  });

  it("id inexistente devolve false nas duas operações", async () => {
    expect(await repo.restaurar(999_999)).toBe(false);
    expect(await repo.esquecer(999_999)).toBe(false);
  });
});

describe("registrar uso", () => {
  it("conta os usos e ignora id que não existe", async () => {
    const [alvo] = await repo.listarMemorias();
    const antes = alvo.usos ?? 0;

    await repo.registrarUso([alvo.id, 999_999]);

    const depois = (await repo.listarMemorias()).find((memoria) => memoria.id === alvo.id)!;
    expect(depois.usos).toBe(antes + 1);
  });

  it("lista vazia não quebra", async () => {
    await expect(repo.registrarUso([])).resolves.toBeUndefined();
  });
});
