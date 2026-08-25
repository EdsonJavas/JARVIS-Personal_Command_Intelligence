import { describe, expect, it } from "vitest";
import { runPowerShell } from "./shell";

/**
 * A saída do PowerShell, do jeito que ela realmente volta.
 *
 * Dois defeitos aqui contaminavam TODA ferramenta do Jarvis, não só uma, e
 * nenhum dos dois aparecia como erro — o comando saía com código zero e a saída
 * parecia plausível.
 */

const sinal = new AbortController().signal;
const noWindows = process.platform === "win32" ? it : it.skip;

describe("saída do PowerShell", () => {
  noWindows("não traz CLIXML grudado no resultado", async () => {
    // O PowerShell escreve um registro de progresso em CLIXML no stderr —
    // "Preparando módulos para primeiro uso" — que era concatenado à saída.
    // Um Get-Clipboard de 44 caracteres voltava com 444, e o excedente parecia
    // conteúdo do comando.
    const r = await runPowerShell("Write-Output 'ok'", { timeoutMs: 15_000, sinal });

    expect(r.ok).toBe(true);
    expect(r.output).not.toContain("CLIXML");
    expect(r.output).not.toContain("<Objs");
    expect(r.output.trim()).toBe("ok");
  }, 20_000);

  noWindows("preserva acentos", async () => {
    // O PowerShell escreve na página de código do console, e o Node decodifica
    // como UTF-8: sem acertar isso, "Relatório" voltava "Relat?rio" e o modelo
    // recebia texto quebrado como se fosse o conteúdo real.
    const r = await runPowerShell("Write-Output 'Relatório de manutenção: ção, ãõ, çà'", {
      timeoutMs: 15_000,
      sinal,
    });

    expect(r.ok).toBe(true);
    expect(r.output.trim()).toBe("Relatório de manutenção: ção, ãõ, çà");
  }, 20_000);

  noWindows("o tamanho da saída é o do conteúdo, sem sobra", async () => {
    // A prova numérica do defeito: eram sempre ~400 caracteres a mais.
    const r = await runPowerShell("Write-Output '1234567890'", { timeoutMs: 15_000, sinal });
    expect(r.output.trim().length).toBe(10);
  }, 20_000);
});
