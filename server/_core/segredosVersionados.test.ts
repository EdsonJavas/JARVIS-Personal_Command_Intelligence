import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inspecionarSegredo } from "../memoria/filtroDeSegredos";

/**
 * Nenhum valor do `.env` pode estar versionado.
 *
 * Este teste existe por um acidente real: uma amostra do teste do filtro de
 * segredos foi escrita com a chave VIVA do Gemini em vez de um exemplo, e
 * atravessou 24 commits sem ninguém notar. Quem barrou foi a varredura do
 * GitHub, no push — tarde demais para ser confortável, e cedo demais para ter
 * virado dano.
 *
 * A ironia é o ponto: o projeto tem um filtro que bloqueia chave de API antes
 * de gravar na memória, e o furo foi no ARQUIVO DE TESTE desse filtro. Filtro
 * nenhum inspeciona o próprio código-fonte.
 *
 * Confere o repositório inteiro, não só o que mudou, porque o valor pode ter
 * entrado numa ida anterior e continuar lá parado.
 */

const RAIZ = process.cwd();
const CAMINHO_ENV = `${RAIZ}/.env`;

/**
 * Valores curtos ficam de fora: `VOZ_MICROSOFT=0` ou `NODE_ENV=test` casariam
 * com meio repositório e transformariam o teste num gerador de alarme falso.
 */
const TAMANHO_MINIMO = 12;

/**
 * Um valor é dispensado quando as DUAS coisas valem:
 *
 *  1. ele já está no `.env.example`, ou seja, foi publicado de propósito como
 *     padrão documentado;
 *  2. o filtro de segredos do próprio projeto não o acusa.
 *
 * A segunda condição é o que impede a primeira de virar porta dos fundos: pôr
 * uma chave de verdade no `.env.example` não a torna pública por decreto.
 *
 * A regra é sobre o VALOR, nunca sobre o nome da variável. Um `DATABASE_URL`
 * com senha embutida continua sendo pego.
 */
function ehPadraoPublicado(valor: string, exemplo: string): boolean {
  if (!exemplo.includes(valor)) return false;
  return inspecionarSegredo(valor).permitido;
}

function valoresDoEnv(): Array<{ nome: string; valor: string }> {
  if (!existsSync(CAMINHO_ENV)) return [];

  const exemplo = existsSync(`${RAIZ}/.env.example`)
    ? readFileSync(`${RAIZ}/.env.example`, "utf8")
    : "";

  return readFileSync(CAMINHO_ENV, "utf8")
    .split("\n")
    .map((linha) => linha.trim())
    .filter((linha) => linha && !linha.startsWith("#") && linha.includes("="))
    .map((linha) => {
      const corte = linha.indexOf("=");
      return {
        nome: linha.slice(0, corte).trim(),
        valor: linha.slice(corte + 1).trim().replace(/^["']|["']$/g, ""),
      };
    })
    .filter(({ valor }) => valor.length >= TAMANHO_MINIMO && !ehPadraoPublicado(valor, exemplo));
}

/** Arquivos rastreados que contêm o valor. `-F` porque chave tem `.` e `-`. */
function arquivosQueContem(valor: string): string[] {
  try {
    const saida = execFileSync("git", ["grep", "-l", "-F", valor, "--", "."], {
      cwd: RAIZ,
      encoding: "utf8",
    });
    return saida.split("\n").filter(Boolean);
  } catch {
    // git grep sai com 1 quando não acha: é o caso bom.
    return [];
  }
}

describe("segredos fora do versionamento", () => {
  const valores = valoresDoEnv();

  it("o .env não está rastreado", () => {
    let saida = "";
    try {
      saida = execFileSync("git", ["ls-files", "--error-unmatch", ".env"], {
        cwd: RAIZ,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      saida = "";
    }
    expect(saida.trim()).toBe("");
  });

  it("nenhum valor do .env aparece em arquivo versionado", () => {
    if (valores.length === 0) {
      // Sem `.env` — máquina de CI, por exemplo. Nada a comparar.
      expect(true).toBe(true);
      return;
    }

    // A mensagem cita o NOME e o ARQUIVO, nunca o valor: um teste que vaza o
    // segredo no log da falha troca um problema por outro.
    const vazamentos = valores
      .map(({ nome, valor }) => ({ nome, arquivos: arquivosQueContem(valor) }))
      .filter(({ arquivos }) => arquivos.length > 0)
      .map(({ nome, arquivos }) => `${nome} aparece em ${arquivos.join(", ")}`);

    expect(vazamentos).toEqual([]);
  });
});
