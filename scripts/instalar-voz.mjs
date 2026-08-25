#!/usr/bin/env node
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

/**
 * Instala a voz local do Jarvis.
 *
 * O binário e os modelos somam quase 200 MB e não pertencem ao histórico do
 * repositório, então ficam fora do git e são baixados por aqui. Sem isto, uma
 * cópia nova do projeto sobe muda — ou pior, cai na voz antiga do Windows, que
 * é exatamente o problema que a voz local existe para resolver.
 *
 *   npm run voz:instalar
 *
 * Idempotente: o que já está no lugar é pulado, então rodar de novo depois de
 * uma queda de conexão retoma de onde parou.
 */

const RAIZ = resolve(process.cwd(), "vendor");
const PASTA_VOZES = join(RAIZ, "vozes");

const PIPER_URL =
  "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip";

/** Vozes brasileiras do projeto Piper, todas masculinas e de licença livre. */
const VOZES = ["cadu", "faber", "jeff"];
const BASE_VOZES = "https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR";

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function baixar(url, destino, rotulo) {
  if (existsSync(destino) && statSync(destino).size > 1024) {
    console.log(`  ${rotulo}: já está aqui (${mb(statSync(destino).size)})`);
    return;
  }

  process.stdout.write(`  ${rotulo}: baixando…`);
  const resposta = await fetch(url, { redirect: "follow" });
  if (!resposta.ok || !resposta.body) {
    throw new Error(`${rotulo} falhou: HTTP ${resposta.status}`);
  }

  // Grava em arquivo temporário e só então renomeia: uma queda no meio deixaria
  // um arquivo truncado que a próxima execução consideraria pronto.
  const parcial = `${destino}.parcial`;
  await pipeline(resposta.body, createWriteStream(parcial));
  const { renameSync } = await import("node:fs");
  renameSync(parcial, destino);
  console.log(` ${mb(statSync(destino).size)}`);
}

async function main() {
  if (process.platform !== "win32") {
    console.log("A voz local hoje só tem binário para Windows. Nada a fazer.");
    return;
  }

  mkdirSync(PASTA_VOZES, { recursive: true });

  console.log("Sintetizador:");
  const zip = join(RAIZ, "piper.zip");
  await baixar(PIPER_URL, zip, "piper");

  if (!existsSync(join(RAIZ, "piper", "piper", "piper.exe"))) {
    process.stdout.write("  extraindo…");
    // Expand-Archive existe em qualquer Windows moderno; não exige nada extra.
    execFileSync(
      "powershell",
      ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${join(RAIZ, "piper")}' -Force`],
      { stdio: "ignore" }
    );
    console.log(" pronto");
  }

  console.log("Vozes:");
  for (const voz of VOZES) {
    const nome = `pt_BR-${voz}-medium`;
    await baixar(`${BASE_VOZES}/${voz}/medium/${nome}.onnx`, join(PASTA_VOZES, `${nome}.onnx`), voz);
    await baixar(
      `${BASE_VOZES}/${voz}/medium/${nome}.onnx.json`,
      join(PASTA_VOZES, `${nome}.onnx.json`),
      `${voz} (config)`
    );
  }

  // O zip já cumpriu seu papel e são 21 MB parados.
  await rm(zip, { force: true });

  const instaladas = readdirSync(PASTA_VOZES).filter((a) => a.endsWith(".onnx"));
  console.log(`\nPronto: ${instaladas.length} voz(es) instalada(s).`);
  console.log("Escolha a preferida no seletor de voz, dentro do Jarvis.");
}

main().catch((erro) => {
  console.error("\nFalhou:", erro.message);
  console.error("Rode de novo — o que já baixou é aproveitado.");
  process.exit(1);
});
