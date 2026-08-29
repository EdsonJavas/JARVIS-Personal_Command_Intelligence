import { randomUUID } from "node:crypto";
import type { EventoSemNumero } from "@shared/jarvisStream";
import { GRUPOS } from "../jarvis/selecaoDeFerramentas";
import { invokeTool, nomesDasFerramentas, toolSchemas } from "../tools/registry";
import { paraEsquemaGoogle, type DeclaracaoDeFerramenta } from "./protocoloLive";

/**
 * A ponte entre o `toolCall` da Live e as ferramentas que já existem.
 *
 * O princípio de todo o modo ao vivo está aqui: NADA é reimplementado. A
 * mesma `invokeTool`, o mesmo contexto de execução, a mesma trava de risco. O
 * WebSocket só carrega áudio e transcrição; ferramenta, pergunta e confirmação
 * continuam pelo caminho que a interface já lê.
 *
 * Isso não é elegância — é segurança. Uma segunda implementação da trava seria
 * uma segunda chance de errar nela, e o dono foi explícito: voz nunca autoriza
 * ação destrutiva, só clique.
 */

/** As ferramentas que entram no `setup`, que é enviado uma vez só. */
export function declaracoesParaLive(): DeclaracaoDeFerramenta[] {
  /*
   * Só as nativas. Os 33 KB do grupo de agenda custariam no aperto de mão de
   * cada sessão, e `selecionarFerramentas` depende do pedido do turno — que
   * numa conversa contínua não existe.
   */
  const nativas = nomesDasFerramentas().filter(
    (nome) => !GRUPOS.some((g) => nome.startsWith(g.prefixo))
  );

  return toolSchemas(nativas).map((t) => ({
    name: t.function.name,
    description: t.function.description,
    parameters: paraEsquemaGoogle(t.function.parameters),
  }));
}

export type ChamadaDaLive = { id?: string; name: string; args: Record<string, unknown> };

/**
 * Executa uma chamada da Live e devolve o texto que volta para o modelo.
 *
 * `interativo: true` não é negociável: com `false`, `abrirPergunta` responde na
 * hora que "não há canal para confirmar" e a ação destrutiva é recusada em
 * silêncio — o dono nunca veria o cartão.
 */
export async function executarDaLive(
  chamada: ChamadaDaLive,
  contexto: {
    execucaoId: string;
    sinal: AbortSignal;
    emitir: (evento: EventoSemNumero) => void;
    autorizacoes: Set<string>;
    prazoMs?: number;
  }
): Promise<{ resultado: string; ok: boolean }> {
  const acaoId = randomUUID();
  const inicio = Date.now();

  const saida = await invokeTool(chamada.name, JSON.stringify(chamada.args ?? {}), {
    execucaoId: contexto.execucaoId,
    acaoId,
    sinal: contexto.sinal,
    emitir: contexto.emitir,
    interativo: true,
    autorizacoes: contexto.autorizacoes,
    perguntasFeitas: 0,
    prazoMs: contexto.prazoMs ?? 30_000,
    creditarEspera: () => {},
  });

  /*
   * `invokeTool` emite `acao_inicio` mas NÃO emite `acao_fim` — quem faz isso
   * é o laço agêntico. Sem emitir aqui, a interface fica com ações penduradas
   * em "executando" para sempre.
   */
  contexto.emitir({
    tipo: "acao_fim",
    acaoId,
    ferramenta: chamada.name,
    detalhe: saida.detail,
    ok: saida.ok,
    bloqueada: saida.bloqueada,
    duracaoMs: Date.now() - inicio,
    resumo: saida.resumo,
  });

  return { resultado: saida.output, ok: saida.ok };
}
