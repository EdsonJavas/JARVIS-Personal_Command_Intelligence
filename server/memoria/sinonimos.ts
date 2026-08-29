import { radical } from "./relevancia";

/**
 * Ponte entre como o dono pergunta e como a memória foi escrita.
 *
 * O casamento é léxico: Dice sobre radicais. Isso acerta "onde eu moro?" contra
 * "mora em Marília" e erra tudo o que muda de palavra. O caso que expôs o
 * problema: "qual editor eu uso?" não recupera "o Senhor trabalha no Cursor" —
 * zero tokens em comum, apesar de ser exatamente a memória procurada.
 *
 * É uma tabela escrita à mão, e assumo isso: é um assistente de UM usuário, com
 * vocabulário pequeno e estável. Vinte linhas resolvem o que um modelo de
 * embedding resolveria a 750 ms por turno — e aqui custa zero.
 *
 * Expande somente o lado da CONSULTA. Expandir os dois infla o denominador do
 * Dice e derruba todas as pontuações de uma vez.
 */
const RELACIONADOS: Record<string, string[]> = {
  editor: ["cursor", "vscode", "code", "ide", "programa"],
  ide: ["cursor", "vscode", "editor"],
  maquina: ["pc", "computador", "notebook", "micro", "desktop"],
  computador: ["pc", "maquina", "notebook"],
  pasta: ["diretorio", "documento", "download", "area de trabalho"],
  arquivo: ["documento", "pasta"],
  cidade: ["mora", "endereco", "marilia", "onde"],
  mora: ["cidade", "endereco", "marilia"],
  trabalho: ["empresa", "cliente", "projeto", "intellisys", "emprego"],
  empresa: ["trabalho", "cliente", "intellisys"],
  projeto: ["repositorio", "repo", "trabalho", "app", "sistema"],
  linguagem: ["flutter", "dart", "typescript", "javascript", "node", "react", "python"],
  programa: ["aplicativo", "app", "software", "editor"],
  navegador: ["chrome", "edge", "firefox", "browser"],
  banco: ["sqlite", "postgres", "mysql", "database", "dados"],
  voz: ["fala", "audio", "som", "falar"],
  agenda: ["calendario", "compromisso", "reuniao"],
  gosta: ["prefere", "aprecia", "curte", "prefiro"],
  prefere: ["gosta", "aprecia", "prefiro"],
  odeia: ["detesta", "nao gosta"],
  nome: ["chama", "chamar", "tratamento"],
  telefone: ["celular", "numero", "contato"],
};

/**
 * Índice por radical, montado na primeira consulta.
 *
 * Preguiçoso de propósito: `relevancia` importa este módulo e este importa
 * `radical` daquele. Montar o índice no topo executaria `radical` antes de o
 * outro módulo terminar de carregar, e o ciclo estoura com "not a function".
 */
let porRadical: Map<string, string[]> | null = null;
function indice(): Map<string, string[]> {
  if (porRadical) return porRadical;
  porRadical = new Map();
  for (const [chave, valores] of Object.entries(RELACIONADOS)) {
    porRadical.set(radical(chave), valores);
  }
  return porRadical;
}

/**
 * Devolve os termos relacionados a acrescentar à consulta.
 *
 * Devolve texto, não tokens: quem chama já sabe tokenizar, e assim a expansão
 * atravessa qualquer marcador (Dice, trigrama) sem acoplamento.
 */
export function expandirConsulta(consulta: string): string {
  const extras = new Set<string>();
  for (const palavra of consulta.toLocaleLowerCase("pt-BR").split(/\W+/)) {
    if (palavra.length < 3) continue;
    for (const termo of indice().get(radical(palavra)) ?? []) extras.add(termo);
  }
  return extras.size ? `${consulta} ${[...extras].join(" ")}` : consulta;
}
