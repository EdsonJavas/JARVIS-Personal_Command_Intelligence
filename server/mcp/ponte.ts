import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ToolDefinition } from "../tools/registry";

/**
 * Ponte MCP: servidores externos viram ferramentas do Jarvis.
 *
 * A alternativa era escrever um cliente do Google à mão. Isto é melhor por um
 * motivo que vale além do Google: o que for plugado aqui entra no MESMO laço —
 * com narração, trava de risco, deduplicação e orçamento — sem código novo por
 * integração. Agenda e e-mail hoje; amanhã o que existir.
 *
 * Cada servidor roda como processo separado, e uma falha dele não derruba o
 * Jarvis: as ferramentas daquele servidor simplesmente não aparecem no catálogo.
 */

export type ServidorMcp = {
  /** Prefixo das ferramentas na conversa, para não colidir entre servidores. */
  nome: string;
  comando: string;
  argumentos?: string[];
  ambiente?: Record<string, string>;
  /** Falso deixa o servidor configurado mas fora do catálogo. */
  ativo?: boolean;
  /**
   * Ferramentas que exigem confirmação, ALÉM das detectadas pelo nome.
   *
   * O servidor MCP não sabe o que é perigoso para o dono, e o modelo não decide
   * isso. Enviar e-mail ou apagar evento não pode acontecer sem ele ver.
   */
  arriscadas?: string[];
  /**
   * Ferramentas que o classificador acusou mas que são inofensivas aqui.
   *
   * Existe porque a detecção por nome erra para o lado seguro de propósito, e
   * sem uma saída explícita ela viraria estorvo — "create_event" da agenda pede
   * confirmação sem necessidade.
   */
  seguras?: string[];
};

/**
 * Verbos que mudam o mundo de forma difícil de desfazer.
 *
 * O padrão para ferramenta EXTERNA é desconfiar. No primeiro teste da ponte, um
 * servidor qualquer expôs `delete_entities` e ela entrou no catálogo como
 * leitura, sem confirmação — porque eu não a tinha listado. Confiar no que não
 * escrevi, e ainda por omissão, é o oposto da regra do projeto.
 */
const VERBOS_PERIGOSOS =
  /(^|[_-])(delete|remove|destroy|drop|purge|trash|clear|wipe|send|reply|forward|publish|revoke|cancel|archive|move|rename|overwrite|write|update|modify|patch|edit|set)([_-]|$)/i;

/** A ferramenta externa precisa de confirmação? Na dúvida, precisa. */
export function ehArriscada(servidor: ServidorMcp, ferramenta: string): boolean {
  if ((servidor.seguras ?? []).includes(ferramenta)) return false;
  if ((servidor.arriscadas ?? []).includes(ferramenta)) return true;
  return VERBOS_PERIGOSOS.test(ferramenta);
}

/** Prazo de conexão. Servidor que não sobe não pode travar o arranque. */
const PRAZO_CONEXAO_MS = 20_000;

type Conexao = { servidor: ServidorMcp; cliente: Client };

const conexoes: Conexao[] = [];

/** Sem prefixo os nomes colidem — dois servidores com "search" viram um só. */
function nomeCompleto(servidor: ServidorMcp, ferramenta: string): string {
  return `${servidor.nome}_${ferramenta}`;
}

/**
 * Converte o resultado do MCP em texto.
 *
 * O protocolo devolve uma lista de blocos que pode conter texto, imagem ou
 * recurso. O laço do Jarvis trabalha com texto, e uma imagem no meio viraria
 * "[object Object]" — pior que dizer que ela existe e não foi lida.
 */
function comoTexto(resultado: unknown): string {
  const conteudo = (resultado as { content?: unknown[] })?.content;
  if (!Array.isArray(conteudo)) return JSON.stringify(resultado ?? {}).slice(0, 4000);

  const partes = conteudo.map((bloco) => {
    const b = bloco as { type?: string; text?: string; resource?: { uri?: string } };
    if (b.type === "text" && typeof b.text === "string") return b.text;
    if (b.type === "image") return "(uma imagem, que não dá para ler aqui)";
    if (b.type === "resource") return `(recurso: ${b.resource?.uri ?? "sem endereço"})`;
    return "";
  });

  return partes.filter(Boolean).join("\n").trim();
}

/** Adapta uma ferramenta do MCP ao contrato do catálogo do Jarvis. */
function adaptar(
  servidor: ServidorMcp,
  cliente: Client,
  ferramenta: { name: string; description?: string; inputSchema?: unknown }
): ToolDefinition {
  const nome = nomeCompleto(servidor, ferramenta.name);
  const arriscada = ehArriscada(servidor, ferramenta.name);

  return {
    name: nome,
    description: ferramenta.description ?? `Ferramenta ${ferramenta.name} de ${servidor.nome}.`,
    parameters: (ferramenta.inputSchema as Record<string, unknown>) ?? {
      type: "object",
      properties: {},
    },
    // Arriscada é sempre escrita: é o que a poda de contexto e o registro usam
    // para saber que o mundo mudou depois desta chamada.
    efeito: arriscada ? "escrita" : "leitura",
    describe: (args) => `${ferramenta.name}: ${JSON.stringify(args ?? {}).slice(0, 70)}`,
    narrar: () => `Vou usar o ${servidor.nome}.`,
    risco: arriscada
      ? () => ({
          nivel: "destrutivo" as const,
          resumo: `Isso executa "${ferramenta.name}" na sua conta do ${servidor.nome}.`,
          impacto: "A ação acontece na conta de verdade, e não dá para desfazer daqui.",
          chave: `${servidor.nome}:${ferramenta.name}`,
        })
      : undefined,
    execute: async (args, ctx) => {
      try {
        const resultado = await cliente.callTool(
          { name: ferramenta.name, arguments: args ?? {} },
          undefined,
          { signal: ctx.sinal, timeout: Math.max(5_000, ctx.prazoMs) }
        );

        const texto = comoTexto(resultado);
        // `isError` é do protocolo: sem lê-lo, uma falha do servidor chegaria ao
        // modelo como sucesso e ele seguiria em frente sobre dado que não existe.
        const falhou = Boolean((resultado as { isError?: boolean })?.isError);

        return { texto: texto || "(sem resposta)", ok: !falhou };
      } catch (erro) {
        return {
          texto: `O ${servidor.nome} não respondeu: ${String(erro).slice(0, 200)}`,
          ok: false,
        };
      }
    },
  };
}

/**
 * Sobe um servidor e devolve as ferramentas dele.
 *
 * Nunca lança: servidor fora do ar é situação normal — credencial vencida,
 * pacote não instalado, internet caída. O Jarvis segue com o resto do catálogo.
 */
async function conectar(servidor: ServidorMcp): Promise<ToolDefinition[]> {
  const cliente = new Client(
    { name: "jarvis", version: "1.0.0" },
    { capabilities: {} }
  );

  const transporte = new StdioClientTransport({
    command: servidor.comando,
    args: servidor.argumentos ?? [],
    // O ambiente do processo é herdado de propósito: o servidor precisa de PATH
    // e das variáveis de credencial. O que for específico vem por cima.
    env: { ...(process.env as Record<string, string>), ...(servidor.ambiente ?? {}) },
  });

  const prazo = new Promise<never>((_, rejeitar) =>
    setTimeout(
      () => rejeitar(new Error(`não respondeu em ${PRAZO_CONEXAO_MS / 1000}s`)),
      PRAZO_CONEXAO_MS
    )
  );

  try {
    await Promise.race([cliente.connect(transporte), prazo]);
    const { tools } = await cliente.listTools();

    conexoes.push({ servidor, cliente });
    console.log(`[MCP] ${servidor.nome}: ${tools.length} ferramenta(s).`);

    return tools.map((ferramenta) => adaptar(servidor, cliente, ferramenta));
  } catch (erro) {
    console.warn(`[MCP] ${servidor.nome} não subiu: ${String(erro).slice(0, 180)}`);
    await cliente.close().catch(() => {});
    return [];
  }
}

/**
 * Sobe todos os servidores configurados, em paralelo.
 *
 * Em paralelo porque um servidor lento não deve atrasar os outros: são processos
 * independentes, e o prazo de cada um já é individual.
 */
export async function conectarServidores(servidores: ServidorMcp[]): Promise<ToolDefinition[]> {
  const ativos = servidores.filter((servidor) => servidor.ativo !== false);
  if (ativos.length === 0) return [];

  const listas = await Promise.all(ativos.map(conectar));
  return listas.flat();
}

/** Encerra tudo. Chamado na saída, para não deixar processo filho órfão. */
export async function encerrarServidores(): Promise<void> {
  await Promise.all(conexoes.map(({ cliente }) => cliente.close().catch(() => {})));
  conexoes.length = 0;
}

export function servidoresConectados(): string[] {
  return conexoes.map(({ servidor }) => servidor.nome);
}

/**
 * Chama uma ferramenta de um servidor DIRETO, sem passar pelo modelo.
 *
 * Existe para o painel montar o dia do dono — agenda e e-mail — sem gastar
 * uma rodada de cota nem esperar um turno. Só leitura passa por aqui: quem
 * escreve numa conta de verdade continua obrigado a atravessar a trava de
 * risco do laço, e este caminho recusa ferramenta arriscada por construção.
 */
export async function chamarFerramenta(
  servidorNome: string,
  ferramenta: string,
  argumentos: Record<string, unknown>,
  prazoMs = 15_000
): Promise<{ texto: string; ok: boolean } | null> {
  const conexao = conexoes.find(({ servidor }) => servidor.nome === servidorNome);
  if (!conexao) return null;
  if (ehArriscada(conexao.servidor, ferramenta)) {
    return { texto: `"${ferramenta}" é arriscada e não pode ser chamada sem o dono.`, ok: false };
  }
  try {
    const resultado = await conexao.cliente.callTool(
      { name: ferramenta, arguments: argumentos },
      undefined,
      { timeout: prazoMs }
    );
    const falhou = Boolean((resultado as { isError?: boolean })?.isError);
    return { texto: comoTexto(resultado), ok: !falhou };
  } catch (erro) {
    return { texto: String(erro).slice(0, 200), ok: false };
  }
}
