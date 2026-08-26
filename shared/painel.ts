/**
 * As formas do que o Jarvis deixa no painel. Compartilhado: o servidor saneia
 * e grava; a tela desenha. Um tipo novo entra aqui e nos dois lados.
 */

export type TomDoCartao = "neutro" | "atencao" | "alerta" | "bom";

/** Cada forma responde a uma pergunta diferente. */
export type ItemDoCartao =
  | { tipo: "texto"; rotulo?: string; texto: string }
  | {
      tipo: "metrica";
      rotulo: string;
      valor: string;
      unidade?: string;
      tendencia?: "sobe" | "desce" | "estavel";
      tom?: TomDoCartao;
    }
  | { tipo: "progresso"; rotulo: string; valor: number; texto?: string }
  | { tipo: "link"; rotulo?: string; url: string; texto: string }
  | { tipo: "lista"; rotulo?: string; itens: string[] }
  | { tipo: "passo"; texto: string; feito?: boolean }
  | { tipo: "tabela"; colunas: string[]; linhas: string[][] }
  | { tipo: "codigo"; texto: string; linguagem?: string }
  | { tipo: "separador"; rotulo?: string };

export type Cartao = {
  id: number;
  titulo: string;
  subtitulo: string | null;
  itens: ItemDoCartao[];
  tom: TomDoCartao;
  nota: string | null;
  /** Largo ocupa duas colunas: tabela e código precisam de espaço. */
  largura: "normal" | "largo";
  /** Fixado não cai pelo fim quando novos entram. */
  fixado: boolean;
  criadoEm: string;
};
