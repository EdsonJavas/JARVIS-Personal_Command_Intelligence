import { registrarFerramentas } from "../tools/registry";
import { conectarServidores, encerrarServidores, servidoresConectados } from "./ponte";
import { motivoDeAusencia, servidoresConfigurados } from "./configuracao";

/**
 * Sobe os servidores MCP e acrescenta o que eles sabem fazer ao catálogo.
 *
 * Roda em segundo plano de propósito: `npx` pode baixar o pacote na primeira
 * vez, e isso levaria um minuto. Segurar o arranque do Jarvis por causa disso
 * deixaria o dono sem assistente nenhum esperando uma integração opcional.
 *
 * A consequência é honesta e vale registrar: nos primeiros segundos depois de
 * subir, as ferramentas do Google ainda não existem. O modelo simplesmente não
 * as vê, em vez de tentar usá-las e falhar.
 */

let jaRodou = false;

export async function ligarServidoresMcp(): Promise<void> {
  if (jaRodou) return;
  jaRodou = true;

  const configurados = servidoresConfigurados();

  if (configurados.length === 0) {
    const motivo = motivoDeAusencia();
    if (motivo) console.log(`[MCP] ${motivo}`);
    return;
  }

  try {
    const ferramentas = await conectarServidores(configurados);
    if (ferramentas.length === 0) {
      console.warn("[MCP] nenhum servidor respondeu; o Jarvis segue sem eles.");
      return;
    }

    const aceitas = registrarFerramentas(ferramentas);
    console.log(
      `[MCP] ${aceitas} ferramenta(s) no catálogo, de: ${servidoresConectados().join(", ")}.`
    );
  } catch (erro) {
    // Nada aqui pode derrubar o servidor: é integração opcional.
    console.warn("[MCP] falha ao conectar:", String(erro).slice(0, 180));
  }
}

/** Encerra os processos filhos. Sem isto, cada reinício deixa um npx órfão. */
export async function desligarServidoresMcp(): Promise<void> {
  await encerrarServidores();
}
