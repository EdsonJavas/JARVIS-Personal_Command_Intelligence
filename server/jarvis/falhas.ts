/**
 * Quando insistir, quando mudar de rota e quando desistir.
 *
 * Sem isto, o modelo repete a mesma chamada com os mesmos argumentos esperando
 * resultado diferente — e, no caso de `encerrar_processo` com um PID que o
 * sistema já reciclou, a repetição mata um processo que não era o alvo.
 */

export type RegistroDeTentativa = {
  ferramenta: string;
  assinatura: string;
  ok: boolean;
  /**
   * O dono recusou a ação.
   *
   * Fica registrada para a deduplicação não deixar o modelo insistir, mas NÃO
   * conta como falha: contando, três "cancelar" encerravam o turno como fracasso
   * técnico — inclusive para as partes do pedido que nem precisavam de
   * autorização — e o Jarvis narrava um erro que nunca aconteceu.
   */
  recusada?: boolean;
};

export type DecisaoDeTentativa =
  | { permitir: true }
  | { permitir: false; aviso: string };

/** Quantas falhas seguidas antes de parar de tentar. */
const FALHAS_CONSECUTIVAS = 3;
/** Teto absoluto de falhas no turno inteiro. */
const FALHAS_NO_TURNO = 5;

/**
 * Identidade de uma chamada, estável contra reordenação de chaves.
 *
 * O modelo emite JSON com ordem de chaves variável entre rodadas: sem
 * normalizar, `{a:1,b:2}` e `{b:2,a:1}` pareceriam chamadas diferentes e a
 * deduplicação nunca dispararia.
 */
export function assinaturaDaChamada(nome: string, argsJson: string): string {
  let normalizado = "";
  try {
    const args = argsJson ? JSON.parse(argsJson) : {};
    normalizado = JSON.stringify(ordenarProfundo(args));
  } catch {
    normalizado = (argsJson ?? "").replace(/\s+/g, " ").trim();
  }
  return `${nome}::${normalizado}`;
}

function ordenarProfundo(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenarProfundo);
  if (valor && typeof valor === "object") {
    const entradas = Object.entries(valor as Record<string, unknown>)
      .map(([chave, item]) => [chave, ordenarProfundo(item)] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entradas);
  }
  if (typeof valor === "string") return valor.trim();
  return valor;
}

export function avaliarTentativa(
  historico: RegistroDeTentativa[],
  nome: string,
  assinatura: string
): DecisaoDeTentativa {
  const igual = historico.find((registro) => registro.assinatura === assinatura);
  if (!igual) return { permitir: true };

  if (igual.recusada) {
    return {
      permitir: false,
      aviso:
        "O Senhor Edson já recusou exatamente esta ação neste turno. Não peça de novo: siga com o resto do pedido ou relate o que ficou de fora.",
    };
  }

  if (igual.ok) {
    return {
      permitir: false,
      aviso:
        "Você já executou exatamente esta chamada neste turno e ela funcionou. Use o resultado que já tem em vez de repetir.",
    };
  }

  return {
    permitir: false,
    aviso:
      "Esta chamada, com estes mesmos argumentos, já falhou neste turno. Tente um caminho diferente ou pare e relate.",
  };
}

export function deveDesistir(historico: RegistroDeTentativa[]): boolean {
  // Recusa do dono não entra na conta: quem decidiu foi ele, e desistir do turno
  // inteiro por isso seria transformar uma decisão consciente em erro.
  const falhas = historico.filter((registro) => !registro.recusada);

  const falhasTotais = falhas.filter((registro) => !registro.ok).length;
  if (falhasTotais >= FALHAS_NO_TURNO) return true;

  let consecutivas = 0;
  for (let i = falhas.length - 1; i >= 0; i -= 1) {
    if (falhas[i].ok) break;
    consecutivas += 1;
    if (consecutivas >= FALHAS_CONSECUTIVAS) return true;
  }
  return false;
}
