/**
 * Qual tela fala um aviso que chegou sozinho.
 *
 * A ilha fica aberta o dia inteiro. Se a Ponte também estiver aberta, as duas
 * recebem o mesmo lembrete e o leriam juntas, pelo mesmo alto-falante, com meio
 * segundo de diferença. Então, com a ilha presente, só ela fala; as outras
 * telas mostram o cartão em silêncio.
 */

export type OrigemDaTela = "ilha" | "tela";

export function origemDaTela(parametro: unknown): OrigemDaTela {
  return parametro === "ilha" ? "ilha" : "tela";
}

export function falaNestaTela(origem: OrigemDaTela, abertas: Iterable<OrigemDaTela>): boolean {
  if (origem === "ilha") return true;
  for (const outra of abertas) if (outra === "ilha") return false;
  return true;
}
