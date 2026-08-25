import { existsSync, statSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import type { AvaliacaoDeRisco, ToolDefinition } from "./registry";
import { redigirSegredos } from "../memoria/filtroDeSegredos";

/**
 * Ler e escrever arquivos.
 *
 * Até aqui o Jarvis sabia LISTAR e PROCURAR arquivos, mas não abrir nenhum. Para
 * resumir um contrato ou ajustar uma configuração ele teria que improvisar por
 * PowerShell — sem narração, sem trava de risco e sem tratamento de tamanho.
 *
 * O segredo encontrado na leitura é REDIGIDO, não motivo de recusa. Recusar
 * seria inútil: o dono precisa que ele leia o `.env` para conferir se uma
 * variável existe, e não deveria ter que escolher entre isso e mandar a chave
 * para o provedor.
 */

/** Teto de leitura. Acima disso o modelo não lê melhor, só paga mais. */
const MAX_LEITURA = 60_000;
const MAX_ESCRITA = 200_000;

/** Extensões que não são texto: ler produz lixo binário. */
const BINARIOS = new Set([
  ".exe", ".dll", ".zip", ".rar", ".7z", ".gz", ".tar", ".png", ".jpg", ".jpeg",
  ".gif", ".bmp", ".ico", ".webp", ".mp3", ".mp4", ".wav", ".avi", ".mkv",
  ".pdf", ".docx", ".xlsx", ".pptx", ".onnx", ".db", ".sqlite", ".bin", ".woff",
  ".woff2", ".ttf", ".otf",
]);

function resolverCaminho(bruto: string): string {
  const texto = String(bruto ?? "").trim().replace(/^["']|["']$/g, "");
  // Sem caminho, a pasta do usuário: é onde as coisas dele moram.
  const base = texto || process.env.USERPROFILE || ".";
  return resolve(base.replace(/^~/, process.env.USERPROFILE ?? "~"));
}

/**
 * Heurística de binário pelo conteúdo, não só pela extensão.
 *
 * Byte zero não aparece em texto. Sem esta checagem, um arquivo sem extensão
 * conhecida despejaria milhares de caracteres ilegíveis no contexto do modelo.
 */
function pareceBinario(amostra: Buffer): boolean {
  const limite = Math.min(amostra.length, 4096);
  for (let i = 0; i < limite; i += 1) if (amostra[i] === 0) return true;
  return false;
}

export const lerArquivo: ToolDefinition = {
  name: "ler_arquivo",
  description:
    "Lê o conteúdo de um arquivo de texto: código, configuração, log, anotação, CSV. Use quando ele se referir ao conteúdo de um arquivo, pedir um resumo, ou quando você precisar ver algo antes de alterar. Não serve para PDF, Word ou planilha — para esses, use ver_a_tela com o arquivo aberto.",
  parameters: {
    type: "object",
    properties: {
      caminho: { type: "string", description: "Caminho completo do arquivo" },
      linha_inicial: {
        type: "integer",
        description: "A partir de qual linha ler. Use para arquivo grande, junto com quantas_linhas.",
      },
      quantas_linhas: { type: "integer", description: "Quantas linhas ler a partir da inicial" },
    },
    required: ["caminho"],
  },
  efeito: "leitura",
  describe: (args) => `ler ${String(args.caminho ?? "")}`,
  narrar: (args) => `Vou ler ${String(args.caminho ?? "o arquivo").split(/[\\/]/).pop()}.`,
  execute: async (args) => {
    const caminho = resolverCaminho(args.caminho);

    if (!existsSync(caminho)) {
      return { texto: `Não existe nada em ${caminho}.`, ok: false };
    }

    const info = statSync(caminho);
    if (info.isDirectory()) {
      return { texto: `${caminho} é uma pasta, não um arquivo. Use listar_pasta.`, ok: false };
    }

    if (BINARIOS.has(extname(caminho).toLowerCase())) {
      return {
        texto: `${caminho} não é arquivo de texto (${extname(caminho)}), então não dá para ler o conteúdo direto. Tem ${(info.size / 1024).toFixed(0)} KB.`,
        ok: false,
      };
    }

    const bruto = await readFile(caminho);
    if (pareceBinario(bruto)) {
      return { texto: `${caminho} tem conteúdo binário, não texto.`, ok: false };
    }

    let conteudo = bruto.toString("utf8");
    const totalDeLinhas = conteudo.split("\n").length;

    const inicial = Number(args.linha_inicial);
    const quantas = Number(args.quantas_linhas);
    if (Number.isInteger(inicial) && inicial > 0) {
      const linhas = conteudo.split("\n");
      const fim = Number.isInteger(quantas) && quantas > 0 ? inicial - 1 + quantas : linhas.length;
      conteudo = linhas.slice(inicial - 1, fim).join("\n");
    }

    const cortado = conteudo.length > MAX_LEITURA;
    if (cortado) conteudo = conteudo.slice(0, MAX_LEITURA);

    const { texto, removidos } = redigirSegredos(conteudo);

    const cabecalho =
      `${caminho} — ${totalDeLinhas} linha(s), ${(info.size / 1024).toFixed(1)} KB` +
      (removidos > 0 ? `, ${removidos} segredo(s) ocultado(s) na leitura` : "") +
      (cortado ? `, cortado em ${MAX_LEITURA} caracteres` : "");

    return { texto: `${cabecalho}\n\n${texto}`, ok: true };
  },
};

/**
 * Sobrescrever é destrutivo e passa pela trava.
 *
 * Criar arquivo novo, não: não há nada a perder, e exigir confirmação para cada
 * anotação transformaria a ferramenta em estorvo. A diferença é o arquivo já
 * existir.
 */
function riscoDeEscrita(args: Record<string, any>): AvaliacaoDeRisco | null {
  const caminho = resolverCaminho(args.caminho);
  if (!existsSync(caminho)) return null;
  if (args.modo === "acrescentar") return null;

  const info = statSync(caminho);
  return {
    nivel: "destrutivo",
    resumo: `Isso apaga o conteúdo atual de ${caminho.split(/[\\/]/).pop()}.`,
    impacto: `O arquivo tem ${(info.size / 1024).toFixed(1)} KB e será substituído inteiro.`,
    detalheTecnico: caminho,
    chave: `escrever_arquivo:${caminho}`,
  };
}

export const escreverArquivo: ToolDefinition = {
  name: "escrever_arquivo",
  description:
    "Cria um arquivo de texto, substitui o conteúdo de um existente, ou acrescenta ao fim dele. Use para redigir documento, anotação, script ou configuração que ele pediu. Prefira 'acrescentar' quando ele quiser somar algo ao que já existe.",
  parameters: {
    type: "object",
    properties: {
      caminho: { type: "string", description: "Caminho completo do arquivo a escrever" },
      conteudo: { type: "string", description: "O conteúdo, completo e já formatado" },
      modo: {
        type: "string",
        enum: ["criar", "substituir", "acrescentar"],
        description: "'criar' falha se já existir; 'substituir' troca tudo; 'acrescentar' soma ao fim",
      },
    },
    required: ["caminho", "conteudo"],
  },
  efeito: "escrita",
  describe: (args) => `${args.modo ?? "escrever"} ${String(args.caminho ?? "")}`,
  narrar: (args) => `Vou escrever ${String(args.caminho ?? "o arquivo").split(/[\\/]/).pop()}.`,
  risco: riscoDeEscrita,
  execute: async (args) => {
    const caminho = resolverCaminho(args.caminho);
    const conteudo = String(args.conteudo ?? "");
    const modo = String(args.modo ?? "substituir");

    if (conteudo.length > MAX_ESCRITA) {
      return { texto: `Conteúdo grande demais (${conteudo.length} caracteres).`, ok: false };
    }

    if (modo === "criar" && existsSync(caminho)) {
      return {
        texto: `${caminho} já existe. Use 'substituir' para trocar o conteúdo ou 'acrescentar' para somar ao fim.`,
        ok: false,
      };
    }

    try {
      // A pasta é criada junto: pedir para escrever num caminho que ainda não
      // existe é pedido comum, e falhar por isso seria burocracia.
      await mkdir(dirname(caminho), { recursive: true });

      if (modo === "acrescentar" && existsSync(caminho)) {
        const anterior = await readFile(caminho, "utf8");
        const separador = anterior.endsWith("\n") ? "" : "\n";
        await writeFile(caminho, anterior + separador + conteudo, "utf8");
      } else {
        await writeFile(caminho, conteudo, "utf8");
      }

      const linhas = conteudo.split("\n").length;
      return {
        texto: `Gravado em ${caminho}: ${linhas} linha(s), ${conteudo.length} caracteres.`,
        ok: true,
      };
    } catch (erro) {
      return { texto: `Não consegui gravar: ${String(erro).slice(0, 200)}`, ok: false };
    }
  },
};

export const editarArquivo: ToolDefinition = {
  name: "editar_arquivo",
  description:
    "Troca um trecho exato dentro de um arquivo, deixando o resto intacto. Prefira isto a reescrever o arquivo inteiro quando a mudança for pontual — é mais seguro e não perde o que você não viu. Leia o arquivo antes, para o trecho procurado bater exatamente.",
  parameters: {
    type: "object",
    properties: {
      caminho: { type: "string", description: "Caminho completo do arquivo" },
      procurar: { type: "string", description: "O trecho exato a substituir, como está no arquivo" },
      substituir: { type: "string", description: "O que colocar no lugar" },
    },
    required: ["caminho", "procurar", "substituir"],
  },
  efeito: "escrita",
  describe: (args) => `editar ${String(args.caminho ?? "")}`,
  narrar: (args) => `Vou ajustar ${String(args.caminho ?? "o arquivo").split(/[\\/]/).pop()}.`,
  risco: (args) => {
    const caminho = resolverCaminho(args.caminho);
    if (!existsSync(caminho)) return null;
    return {
      nivel: "destrutivo",
      resumo: `Isso altera ${caminho.split(/[\\/]/).pop()}.`,
      impacto: "Um trecho do arquivo será trocado por outro.",
      detalheTecnico: caminho,
      chave: `editar_arquivo:${caminho}`,
    };
  },
  execute: async (args) => {
    const caminho = resolverCaminho(args.caminho);
    const procurar = String(args.procurar ?? "");
    const substituir = String(args.substituir ?? "");

    if (!existsSync(caminho)) return { texto: `Não existe nada em ${caminho}.`, ok: false };
    if (!procurar) return { texto: "Não disse qual trecho procurar.", ok: false };

    const conteudo = await readFile(caminho, "utf8");
    const ocorrencias = conteudo.split(procurar).length - 1;

    if (ocorrencias === 0) {
      return {
        texto: `Não achei esse trecho em ${caminho}. Leia o arquivo e use o texto exato, com a mesma indentação.`,
        ok: false,
      };
    }

    /*
     * Trecho repetido é recusado em vez de trocar o primeiro.
     *
     * Trocar "o primeiro que aparecer" acerta por sorte e erra em silêncio: o
     * arquivo fica alterado no lugar errado, e ninguém percebe até quebrar.
     */
    if (ocorrencias > 1) {
      return {
        texto: `Esse trecho aparece ${ocorrencias} vezes em ${caminho}. Inclua mais contexto em volta para identificar qual deles.`,
        ok: false,
      };
    }

    try {
      await writeFile(caminho, conteudo.replace(procurar, substituir), "utf8");
      return { texto: `Alterado ${caminho}.`, ok: true };
    } catch (erro) {
      return { texto: `Não consegui alterar: ${String(erro).slice(0, 200)}`, ok: false };
    }
  },
};

export const FERRAMENTAS_DE_ARQUIVO: ToolDefinition[] = [lerArquivo, escreverArquivo, editarArquivo];
