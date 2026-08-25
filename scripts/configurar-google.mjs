#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * Guia de configuração do Google: agenda e e-mail.
 *
 * É o único ponto do projeto que depende de uma ação do Senhor Edson fora daqui,
 * porque o Google exige que a credencial seja criada por quem é dono da conta —
 * não há como automatizar isso sem pedir a senha dele, o que não vou fazer.
 *
 * O script CONFERE o que já existe e só pede o que falta, em vez de despejar um
 * passo a passo de vinte itens que ele teria que ler inteiro para descobrir que
 * já estava tudo pronto.
 */

const ENV = resolve(process.cwd(), ".env");

const AZUL = "\x1b[36m";
const AMARELO = "\x1b[33m";
const VERDE = "\x1b[32m";
const CINZA = "\x1b[90m";
const FIM = "\x1b[0m";

function lerEnv() {
  if (!existsSync(ENV)) return {};
  const mapa = {};
  for (const linha of readFileSync(ENV, "utf8").split("\n")) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) mapa[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return mapa;
}

function acrescentarAoEnv(chaves) {
  const atual = existsSync(ENV) ? readFileSync(ENV, "utf8") : "";
  const faltando = Object.entries(chaves).filter(([k]) => !new RegExp(`^\\s*${k}\\s*=`, "m").test(atual));
  if (faltando.length === 0) return 0;

  const bloco =
    (atual.endsWith("\n") || atual === "" ? "" : "\n") +
    "\n# Google — agenda e e-mail (preenchido por npm run google:configurar)\n" +
    faltando.map(([k, v]) => `${k}=${v}`).join("\n") +
    "\n";

  writeFileSync(ENV, atual + bloco, "utf8");
  return faltando.length;
}

const env = lerEnv();
const temId = Boolean(env.GOOGLE_CLIENT_ID);
const temSegredo = Boolean(env.GOOGLE_CLIENT_SECRET);
const caminhoCred = env.GOOGLE_OAUTH_CREDENTIALS;
const temArquivo = caminhoCred && existsSync(caminhoCred);

console.log(`\n${AZUL}JARVIS — agenda e e-mail do Google${FIM}\n`);

if (temId && temSegredo && temArquivo) {
  console.log(`${VERDE}Já está tudo configurado.${FIM}`);
  console.log(`  credencial: ${caminhoCred}`);
  console.log(`\nReinicie o servidor. No log deve aparecer:`);
  console.log(`  ${CINZA}[MCP] agenda: N ferramenta(s).${FIM}`);
  console.log(`  ${CINZA}[MCP] email: N ferramenta(s).${FIM}\n`);
  process.exit(0);
}

console.log("Isto precisa de você: o Google exige que a credencial seja criada");
console.log("por quem é dono da conta. São cinco minutos, uma vez só.\n");

console.log(`${AMARELO}1.${FIM} Abra ${AZUL}https://console.cloud.google.com/projectcreate${FIM}`);
console.log(`   Crie um projeto. Nome: ${CINZA}jarvis${FIM}\n`);

console.log(`${AMARELO}2.${FIM} Ative as duas APIs no projeto que você acabou de criar:`);
console.log(`   ${AZUL}https://console.cloud.google.com/apis/library/calendar-json.googleapis.com${FIM}`);
console.log(`   ${AZUL}https://console.cloud.google.com/apis/library/gmail.googleapis.com${FIM}`);
console.log(`   Clique em ATIVAR nas duas.\n`);

console.log(`${AMARELO}3.${FIM} Tela de consentimento: ${AZUL}https://console.cloud.google.com/auth/overview${FIM}`);
console.log(`   Tipo: ${CINZA}Externo${FIM}. Preencha só o obrigatório.`);
console.log(`   Em "Usuários de teste", ADICIONE SEU PRÓPRIO E-MAIL.`);
console.log(`   ${CINZA}Sem isso o Google recusa o login com "app não verificado".${FIM}\n`);

console.log(`${AMARELO}4.${FIM} Credencial: ${AZUL}https://console.cloud.google.com/apis/credentials${FIM}`);
console.log(`   Criar credenciais → ID do cliente OAuth → Tipo: ${CINZA}App para computador${FIM}`);
console.log(`   Baixe o JSON e salve como:`);
console.log(`   ${VERDE}${resolve(process.cwd(), "data", "google-credenciais.json")}${FIM}\n`);

console.log(`${AMARELO}5.${FIM} Volte aqui e rode de novo: ${CINZA}npm run google:configurar${FIM}\n`);

const destino = resolve(process.cwd(), "data", "google-credenciais.json");

if (existsSync(destino)) {
  try {
    const json = JSON.parse(readFileSync(destino, "utf8"));
    const dados = json.installed ?? json.web;
    if (!dados?.client_id || !dados?.client_secret) {
      console.log(`${AMARELO}O arquivo existe mas não tem client_id/client_secret.${FIM}`);
      console.log(`Baixe de novo, escolhendo o tipo "App para computador".\n`);
      process.exit(1);
    }

    /*
     * O servidor de e-mail lê a credencial de ~/.gmail-mcp/gcp-oauth.keys.json,
     * e não de variável de ambiente. Copiar aqui evita o erro mais provável do
     * primeiro uso: tudo configurado no .env e o e-mail sem subir, sem motivo
     * aparente.
     */
    const pastaGmail = resolve(homedir(), ".gmail-mcp");
    mkdirSync(pastaGmail, { recursive: true });
    copyFileSync(destino, resolve(pastaGmail, "gcp-oauth.keys.json"));

    const quantas = acrescentarAoEnv({
      GOOGLE_CLIENT_ID: dados.client_id,
      GOOGLE_CLIENT_SECRET: dados.client_secret,
      GOOGLE_OAUTH_CREDENTIALS: destino,
    });

    console.log(`${VERDE}Achei a credencial e ${quantas > 0 ? `escrevi ${quantas} linha(s) no .env` : "o .env já estava pronto"}.${FIM}`);
    console.log(`\nAgora reinicie o servidor. Na PRIMEIRA vez, o Google vai abrir`);
    console.log(`o navegador pedindo autorização — é esperado, e acontece uma vez só.\n`);
  } catch (erro) {
    console.log(`${AMARELO}Não consegui ler ${destino}: ${erro.message}${FIM}\n`);
    process.exit(1);
  }
} else {
  console.log(`${CINZA}Ainda não achei ${destino}.${FIM}\n`);
}
