import type { ToolDefinition } from "./registry";
import {
  cancelarCompromisso,
  criarLembrete,
  criarRotina,
  criarVigia,
  listarCompromissos,
} from "../tempo/compromissos";
import { descreverQuando } from "../tempo/quando";

/**
 * Ferramentas de compromisso: o que dá iniciativa ao Jarvis.
 *
 * Sem elas ele só reage. Com elas passa a ter noção de tempo — marca lembrete,
 * mantém rotina e vigia a máquina — e vai procurar o dono sozinho, mesmo com o
 * navegador fechado.
 */

const str = (description: string) => ({ type: "string", description });

const NOMES_DOS_DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** "8:05" a partir de minutos desde a meia-noite. */
function comoHora(minutos: number): string {
  return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
}

export const lembreteFerramenta: ToolDefinition = {
  name: "criar_lembrete",
  description:
    "Marca um lembrete único, para você avisar o Senhor Edson num momento futuro. Use sempre que ele pedir para ser lembrado de algo, ou disser que precisa fazer algo em determinado horário. Passe o momento com as palavras dele mesmo — 'amanhã às 15h', 'em 20 minutos', 'sexta de manhã' — que o sistema resolve contra o relógio.",
  parameters: {
    type: "object",
    properties: {
      texto: str(
        "O que você vai dizer na hora, em primeira pessoa e já pronto para ser falado em voz alta. Ex.: 'Senhor, a reunião com o cliente é agora.'"
      ),
      quando: str(
        "Quando avisar, nas palavras dele: 'amanhã às 15h', 'em 20 minutos', 'dia 25/12 às 20h'"
      ),
    },
    required: ["texto", "quando"],
  },
  efeito: "escrita",
  describe: (args) => `lembrete: ${String(args.texto ?? "").slice(0, 60)}`,
  narrar: () => "Vou marcar isso.",
  execute: async (args) => {
    const agora = new Date();
    const resultado = await criarLembrete(
      { texto: String(args.texto ?? ""), quando: String(args.quando ?? "") },
      agora
    );

    if (!resultado.ok) {
      // O motivo volta ao modelo para ele PERGUNTAR, em vez de inventar um
      // horário: um lembrete marcado na hora errada é pior que nenhum.
      return {
        texto: `Não consegui marcar: ${resultado.motivo}. Confirme com ele o momento exato.`,
        ok: false,
      };
    }

    const quando = resultado.compromisso.proximaEm!;
    return {
      texto: `Lembrete marcado para ${descreverQuando(quando, agora)} (${quando.toLocaleString("pt-BR")}).`,
      ok: true,
    };
  },
};

export const rotinaFerramenta: ToolDefinition = {
  name: "criar_rotina",
  description:
    "Cria algo que se repete todo dia, ou em dias escolhidos da semana, sempre no mesmo horário. Use para hábitos: o resumo da manhã, o aviso de fim de expediente, o lembrete de pausa.",
  parameters: {
    type: "object",
    properties: {
      texto: str("O que você vai dizer, em primeira pessoa, pronto para a voz"),
      hora: {
        type: "integer",
        description: "Hora do dia, de 0 a 23",
      },
      minuto: { type: "integer", description: "Minuto, de 0 a 59. Zero se ele não disser." },
      dias_da_semana: {
        type: "array",
        items: { type: "integer" },
        description:
          "Dias em que repete, domingo = 0. Omita para todo dia. Dias úteis são [1,2,3,4,5].",
      },
    },
    required: ["texto", "hora"],
  },
  efeito: "escrita",
  describe: (args) => `rotina às ${args.hora}h: ${String(args.texto ?? "").slice(0, 50)}`,
  narrar: () => "Vou deixar isso na rotina.",
  execute: async (args) => {
    const hora = Number(args.hora);
    const minuto = Number(args.minuto ?? 0);
    const dias = Array.isArray(args.dias_da_semana) ? args.dias_da_semana.map(Number) : [];

    const resultado = await criarRotina({
      texto: String(args.texto ?? ""),
      horaDoDia: hora * 60 + minuto,
      diasDaSemana: dias,
    });

    if (!resultado.ok) return { texto: `Não consegui criar: ${resultado.motivo}.`, ok: false };

    const quando = resultado.compromisso.proximaEm;
    const quaisDias =
      dias.length > 0 ? dias.map((dia) => NOMES_DOS_DIAS[dia] ?? "?").join(", ") : "todo dia";

    return {
      texto:
        `Rotina criada: ${quaisDias}, às ${comoHora(hora * 60 + minuto)}. ` +
        (quando ? `A primeira vez é ${descreverQuando(quando, new Date())}.` : ""),
      ok: true,
    };
  },
};

export const vigiaFerramenta: ToolDefinition = {
  name: "criar_vigia",
  description:
    "Fica de olho num número da máquina e avisa quando ele cruzar um limite. Use quando ele pedir para ser avisado sobre disco cheio, memória alta, CPU carregada ou bateria baixa. Avisa uma vez e só volta a avisar depois que o número normalizar.",
  parameters: {
    type: "object",
    properties: {
      texto: str("O aviso que você vai dar, em primeira pessoa, pronto para a voz"),
      metrica: {
        type: "string",
        enum: ["cpu", "memoria", "disco", "bateria"],
        description: "O que observar. Todos em porcentagem.",
      },
      comparacao: {
        type: "string",
        enum: ["acima", "abaixo"],
        description: "'acima' para disco/CPU/memória enchendo; 'abaixo' para bateria acabando",
      },
      limite: { type: "integer", description: "O valor de corte, em porcentagem" },
    },
    required: ["texto", "metrica", "comparacao", "limite"],
  },
  efeito: "escrita",
  describe: (args) => `vigiar ${args.metrica} ${args.comparacao} de ${args.limite}%`,
  narrar: (args) => `Vou ficar de olho ${args.metrica ? `n${args.metrica === "cpu" ? "a CPU" : `a ${args.metrica}`}` : "nisso"}.`,
  execute: async (args) => {
    const resultado = await criarVigia({
      texto: String(args.texto ?? ""),
      metrica: args.metrica,
      comparacao: args.comparacao,
      limite: Number(args.limite),
    });

    if (!resultado.ok) return { texto: `Não consegui criar: ${resultado.motivo}.`, ok: false };

    return {
      texto: `Vigia ativo: aviso quando ${args.metrica} ficar ${args.comparacao} de ${args.limite}%.`,
      ok: true,
    };
  },
};

export const listarCompromissosFerramenta: ToolDefinition = {
  name: "listar_compromissos",
  description:
    "Mostra os lembretes, rotinas e vigias ativos. Use quando ele perguntar o que está marcado, ou antes de cancelar algo, para saber o número de cada um.",
  parameters: { type: "object", properties: {} },
  efeito: "leitura",
  describe: () => "listar compromissos",
  narrar: () => "Vou ver o que está marcado.",
  execute: async () => {
    const todos = await listarCompromissos();
    if (todos.length === 0) {
      return { texto: "Não há nada marcado no momento.", ok: true, resumo: "nada marcado" };
    }

    const agora = new Date();
    const linhas = todos.map((c) => {
      if (c.tipo === "vigia") {
        return `#${c.id} [vigia] ${c.metrica} ${c.comparacao} de ${c.limite}% — "${c.texto}"${c.armado ? "" : " (já avisou, esperando normalizar)"}`;
      }
      if (c.tipo === "rotina") {
        const dias = c.diasDaSemana
          ? c.diasDaSemana.split(",").map((d) => NOMES_DOS_DIAS[Number(d)] ?? "?").join(", ")
          : "todo dia";
        return `#${c.id} [rotina] ${dias} às ${comoHora(c.horaDoDia ?? 0)} — "${c.texto}"`;
      }
      return `#${c.id} [lembrete] ${c.proximaEm ? descreverQuando(c.proximaEm, agora) : "sem data"} — "${c.texto}"`;
    });

    return {
      texto: linhas.join("\n"),
      ok: true,
      resumo: `${todos.length} compromisso(s) ativo(s)`,
    };
  },
};

export const cancelarCompromissoFerramenta: ToolDefinition = {
  name: "cancelar_compromisso",
  description:
    "Cancela um lembrete, rotina ou vigia pelo número. Liste antes se não souber o número — cancelar o errado é pior que perguntar.",
  parameters: {
    type: "object",
    properties: { id: { type: "integer", description: "O número mostrado na listagem" } },
    required: ["id"],
  },
  efeito: "escrita",
  describe: (args) => `cancelar compromisso #${args.id}`,
  narrar: () => "Vou cancelar isso.",
  execute: async (args) => {
    const id = Number(args.id);
    const removido = await cancelarCompromisso(id);
    return removido
      ? { texto: `Compromisso #${id} cancelado.`, ok: true }
      : { texto: `Não achei o compromisso #${id} entre os ativos.`, ok: false };
  },
};

export const FERRAMENTAS_DE_COMPROMISSO: ToolDefinition[] = [
  lembreteFerramenta,
  rotinaFerramenta,
  vigiaFerramenta,
  listarCompromissosFerramenta,
  cancelarCompromissoFerramenta,
];
