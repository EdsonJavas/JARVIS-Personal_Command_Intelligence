import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Cartao, ItemDoCartao, TomDoCartao } from "@shared/painel";

export type { Cartao, ItemDoCartao, TomDoCartao };

/**
 * O que o Jarvis deixa no painel.
 *
 * É a diferença entre um painel que mostra o que alguém programou e um painel
 * que o assistente USA: ele pesquisa, mede, compara, planeja — e aquilo fica
 * na outra janela, com a forma certa para cada coisa. Um número vira métrica
 * com tendência; uma tarefa de cinco passos vira lista de verificação; uma
 * comparação vira tabela. Linha de texto era tudo o que ele tinha antes, e o
 * dono foi claro: ele precisa de mais recurso do que isso.
 *
 * Persistido em disco, não em memória: o dono deu ordem de uso obrigatório,
 * e um reinício do servidor durante o desenvolvimento apagava tudo o que
 * estava na tela.
 */

const MAX_CARTOES = 14;
const MAX_ITENS = 24;

const PASTA_DADOS = process.env.JARVIS_DATA_DIR?.trim() || "data";
const ARQUIVO = resolve(process.cwd(), PASTA_DADOS, "painel.json");

type Registro = { proximoId: number; cartoes: Cartao[] };

let estado: Registro | null = null;

function carregar(): Registro {
  if (estado) return estado;
  try {
    const lido = JSON.parse(readFileSync(ARQUIVO, "utf8")) as Registro;
    if (Array.isArray(lido?.cartoes) && typeof lido.proximoId === "number") {
      estado = lido;
      return estado;
    }
  } catch {
    /* primeiro uso, ou arquivo corrompido: começa vazio */
  }
  estado = { proximoId: 1, cartoes: [] };
  return estado;
}

function gravar(): void {
  try {
    mkdirSync(dirname(ARQUIVO), { recursive: true });
    writeFileSync(ARQUIVO, JSON.stringify(carregar()), "utf8");
  } catch {
    // Sem disco, o painel vale só para este processo. Melhor que falhar.
  }
}

/* -------------------------- saneamento do que chega ------------------------- */

const texto = (valor: unknown, max: number) => String(valor ?? "").trim().slice(0, max);

/**
 * Aceita a entrada crua do modelo e devolve só o que tem forma.
 *
 * O modelo erra tipo, esquece campo e manda número como string. Rejeitar o
 * cartão inteiro por um item torto faria o dono perder a parte boa; o item
 * torto cai fora, ou vira texto quando dá para salvar.
 */
export function sanearItem(bruto: unknown): ItemDoCartao | null {
  if (!bruto || typeof bruto !== "object") return null;
  const b = bruto as Record<string, unknown>;
  const tipo = String(b.tipo ?? "texto");

  switch (tipo) {
    case "metrica": {
      const rotulo = texto(b.rotulo, 40);
      const valor = texto(b.valor, 40);
      if (!rotulo || !valor) return null;
      const tendencia = ["sobe", "desce", "estavel"].includes(String(b.tendencia))
        ? (b.tendencia as "sobe" | "desce" | "estavel")
        : undefined;
      const tom = ["neutro", "atencao", "alerta", "bom"].includes(String(b.tom))
        ? (b.tom as TomDoCartao)
        : undefined;
      return {
        tipo,
        rotulo,
        valor,
        ...(b.unidade ? { unidade: texto(b.unidade, 12) } : {}),
        ...(tendencia ? { tendencia } : {}),
        ...(tom ? { tom } : {}),
      };
    }
    case "progresso": {
      const rotulo = texto(b.rotulo, 60);
      const valor = Number(b.valor);
      if (!rotulo || !Number.isFinite(valor)) return null;
      return {
        tipo,
        rotulo,
        valor: Math.max(0, Math.min(100, Math.round(valor))),
        ...(b.texto ? { texto: texto(b.texto, 120) } : {}),
      };
    }
    case "link": {
      const url = texto(b.url, 600);
      if (!/^https?:\/\//i.test(url)) return null;
      return {
        tipo,
        url,
        texto: texto(b.texto, 160) || url.replace(/^https?:\/\//, "").slice(0, 80),
        ...(b.rotulo ? { rotulo: texto(b.rotulo, 40) } : {}),
      };
    }
    case "lista": {
      const itens = Array.isArray(b.itens)
        ? b.itens.map((i) => texto(i, 200)).filter(Boolean).slice(0, 20)
        : [];
      if (itens.length === 0) return null;
      return { tipo, itens, ...(b.rotulo ? { rotulo: texto(b.rotulo, 40) } : {}) };
    }
    case "passo": {
      const t = texto(b.texto, 200);
      if (!t) return null;
      return { tipo, texto: t, feito: Boolean(b.feito) };
    }
    case "tabela": {
      const colunas = Array.isArray(b.colunas)
        ? b.colunas.map((c) => texto(c, 40)).filter(Boolean).slice(0, 6)
        : [];
      const linhas = Array.isArray(b.linhas)
        ? b.linhas
            .filter(Array.isArray)
            .map((l) => (l as unknown[]).map((c) => texto(c, 80)).slice(0, colunas.length || 6))
            .slice(0, 30)
        : [];
      if (colunas.length === 0 || linhas.length === 0) return null;
      return { tipo, colunas, linhas };
    }
    case "codigo": {
      const t = texto(b.texto, 2000);
      if (!t) return null;
      return { tipo, texto: t, ...(b.linguagem ? { linguagem: texto(b.linguagem, 20) } : {}) };
    }
    case "separador":
      return { tipo, ...(b.rotulo ? { rotulo: texto(b.rotulo, 40) } : {}) };
    default: {
      const t = texto(b.texto, 600);
      if (!t) return null;
      return { tipo: "texto", texto: t, ...(b.rotulo ? { rotulo: texto(b.rotulo, 40) } : {}) };
    }
  }
}

/* --------------------------------- operações -------------------------------- */

export function listarCartoes(): Cartao[] {
  return carregar().cartoes;
}

export function adicionarCartao(entrada: {
  titulo: string;
  subtitulo?: string | null;
  itens: unknown[];
  tom?: TomDoCartao;
  nota?: string | null;
  largura?: "normal" | "largo";
  fixado?: boolean;
}): Cartao | null {
  const itens = entrada.itens.map(sanearItem).filter((i): i is ItemDoCartao => i !== null);
  if (itens.length === 0) return null;

  // Tabela e código pedem largura; o modelo raramente lembra de pedir.
  const precisaDeLargura = itens.some((i) => i.tipo === "tabela" || i.tipo === "codigo");

  const registro = carregar();
  const cartao: Cartao = {
    id: registro.proximoId++,
    titulo: texto(entrada.titulo, 80) || "Sem título",
    subtitulo: entrada.subtitulo ? texto(entrada.subtitulo, 120) : null,
    itens: itens.slice(0, MAX_ITENS),
    tom: entrada.tom ?? "neutro",
    nota: entrada.nota ? texto(entrada.nota, 240) : null,
    largura: entrada.largura === "largo" || precisaDeLargura ? "largo" : "normal",
    fixado: Boolean(entrada.fixado),
    criadoEm: new Date().toISOString(),
  };

  // O mais recente entra na frente. Ao estourar, cai o mais antigo NÃO fixado.
  const todos = [cartao, ...registro.cartoes];
  while (todos.length > MAX_CARTOES) {
    const indice = todos.map((c) => c.fixado).lastIndexOf(false);
    if (indice === -1) break;
    todos.splice(indice, 1);
  }
  registro.cartoes = todos;
  gravar();
  return cartao;
}

export function atualizarCartao(
  id: number,
  mudancas: Partial<Pick<Cartao, "fixado" | "titulo" | "nota">> & {
    /** Marca ou desmarca um passo pelo índice do item. */
    passo?: { indice: number; feito: boolean };
  }
): Cartao | null {
  const registro = carregar();
  const cartao = registro.cartoes.find((c) => c.id === id);
  if (!cartao) return null;

  if (mudancas.fixado !== undefined) cartao.fixado = mudancas.fixado;
  if (mudancas.titulo !== undefined) cartao.titulo = texto(mudancas.titulo, 80) || cartao.titulo;
  if (mudancas.nota !== undefined) cartao.nota = mudancas.nota ? texto(mudancas.nota, 240) : null;
  if (mudancas.passo) {
    const item = cartao.itens[mudancas.passo.indice];
    if (item && item.tipo === "passo") item.feito = mudancas.passo.feito;
  }
  gravar();
  return cartao;
}

export function removerCartao(id: number): boolean {
  const registro = carregar();
  const antes = registro.cartoes.length;
  registro.cartoes = registro.cartoes.filter((cartao) => cartao.id !== id);
  if (registro.cartoes.length !== antes) gravar();
  return registro.cartoes.length !== antes;
}

export function limparCartoes(): number {
  const registro = carregar();
  const quantidade = registro.cartoes.length;
  registro.cartoes = registro.cartoes.filter((c) => c.fixado);
  gravar();
  return quantidade - registro.cartoes.length;
}

/** Só para teste: esquece o estado em memória e relê o disco. */
export function recarregarDoDisco(): void {
  estado = null;
}

/** Resumo para o modelo saber o que já está na tela e não repetir. */
export function describeBoardForModel(): string {
  const cartoes = carregar().cartoes;
  if (cartoes.length === 0) return "";
  return (
    "No painel, você já deixou: " +
    cartoes
      .map((cartao) => {
        const passos = cartao.itens.filter((i) => i.tipo === "passo");
        const feitos = passos.filter((i) => i.tipo === "passo" && i.feito).length;
        const extra = passos.length ? `, ${feitos}/${passos.length} passos feitos` : "";
        return `#${cartao.id} "${cartao.titulo}" (${cartao.itens.length} item(ns)${extra}${cartao.fixado ? ", fixado" : ""})`;
      })
      .join("; ") +
    ". Para marcar um passo como feito ou remover um cartão, use as ferramentas do painel."
  );
}
