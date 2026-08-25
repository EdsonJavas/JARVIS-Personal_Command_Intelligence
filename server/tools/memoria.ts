import type { ToolDefinition } from "./registry";
import { esquecer, lembrar, listarMemorias } from "../memoria/repositorio";
import { montarBlocoDeMemoria, selecionarMemorias } from "../memoria/relevancia";

/**
 * Ferramentas de memória.
 *
 * O que o Jarvis grava aqui sobrevive a reinício e volta em toda conversa
 * futura. Por isso o filtro de segredos roda antes de qualquer gravação, e por
 * isso apagar é reversível.
 */

const str = (description: string) => ({ type: "string", description });

export const lembrarFerramenta: ToolDefinition = {
  name: "lembrar",
  description:
    "Guarda um fato permanente sobre o Senhor Edson, uma preferência dele ou um projeto em andamento. Use quando ele disser algo que valha para conversas futuras, ou quando corrigir você. Um fato por chamada, escrito em uma frase completa e autossuficiente.",
  parameters: {
    type: "object",
    properties: {
      conteudo: str("O fato, em uma frase completa que se entenda sozinha daqui a meses"),
      tipo: {
        type: "string",
        enum: ["fato", "preferencia", "projeto", "correcao"],
        description: "correcao quando ele estiver consertando algo que você errou",
      },
      fixada: {
        type: "boolean",
        description: "Verdadeiro só para o que deve valer em TODA conversa, sem exceção",
      },
    },
    required: ["conteudo"],
  },
  efeito: "escrita",
  describe: (args) => `lembrar: ${String(args.conteudo ?? "").slice(0, 70)}`,
  narrar: () => "Vou anotar isso.",
  execute: async (args) => {
    const resultado = await lembrar({
      conteudo: String(args.conteudo ?? ""),
      tipo: args.tipo,
      origem: "explicita",
      fixada: Boolean(args.fixada),
    });

    if (resultado.estado === "bloqueada") {
      return {
        texto:
          `Não gravei: ${resultado.motivo}. Memória guarda fato curto sobre o Senhor Edson, ` +
          `nunca credencial nem saída de comando.`,
        ok: false,
      };
    }

    if (resultado.estado === "atualizada") {
      return {
        texto: `Atualizei o que eu sabia. Antes: "${resultado.anterior}". Agora: "${resultado.memoria.conteudo}".`,
        ok: true,
      };
    }

    if (resultado.estado === "parecida") {
      return {
        texto:
          `Anotado. Já havia algo parecido: "${resultado.existente.conteudo}". ` +
          `Se um dos dois estiver errado, pergunte qual vale.`,
        ok: true,
      };
    }

    return { texto: `Anotado: "${resultado.memoria.conteudo}".`, ok: true };
  },
};

export const recordarFerramenta: ToolDefinition = {
  name: "recordar",
  description:
    "Consulta o que você já sabe sobre o Senhor Edson. Use quando ele mencionar algo do passado que não esteja nesta conversa.",
  parameters: {
    type: "object",
    properties: { sobre: str("Assunto a procurar. Vazio traz o mais relevante em geral.") },
  },
  efeito: "leitura",
  describe: (args) => `recordar sobre ${args.sobre ?? "tudo"}`,
  execute: async (args) => {
    const todas = await listarMemorias();
    if (todas.length === 0) {
      return { texto: "Você ainda não guardou nada sobre ele.", ok: true };
    }

    const selecionadas = selecionarMemorias(todas, String(args.sobre ?? ""), { maxItens: 10 });
    const bloco = montarBlocoDeMemoria(selecionadas);

    return {
      texto: bloco || "Nada do que você guardou se relaciona com isso.",
      ok: true,
    };
  },
};

export const esquecerFerramenta: ToolDefinition = {
  name: "esquecer",
  description:
    "Marca uma memória como esquecida. Use quando o Senhor Edson pedir para você esquecer algo, ou quando descobrir que aprendeu errado.",
  parameters: {
    type: "object",
    properties: { sobre: str("Assunto a esquecer, com as palavras dele") },
    required: ["sobre"],
  },
  efeito: "escrita",
  describe: (args) => `esquecer: ${String(args.sobre ?? "").slice(0, 60)}`,
  narrar: () => "Vou esquecer isso.",
  execute: async (args) => {
    const todas = await listarMemorias();
    const alvo = selecionarMemorias(todas, String(args.sobre ?? ""), { maxItens: 1 })[0];

    if (!alvo) {
      return { texto: "Não encontrei nada guardado sobre isso.", ok: false };
    }

    await esquecer(alvo.memoria.id, "pedido do dono");
    // Esquecer é marcação, não exclusão: um pedido mal transcrito é reversível.
    return {
      texto: `Esqueci: "${alvo.memoria.conteudo}". Continua recuperável se tiver sido engano.`,
      ok: true,
    };
  },
};

export const FERRAMENTAS_DE_MEMORIA: ToolDefinition[] = [
  lembrarFerramenta,
  recordarFerramenta,
  esquecerFerramenta,
];
