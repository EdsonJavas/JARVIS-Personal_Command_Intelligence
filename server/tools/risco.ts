import type { AvaliacaoDeRisco } from "./registry";

/**
 * Classificação de risco de um comando.
 *
 * A regra é errar para o lado de perguntar. Um falso positivo custa um clique;
 * um falso negativo apaga arquivo do dono sem ele ver.
 *
 * Isto não substitui o julgamento do modelo — substitui a CONFIANÇA nele. A
 * instrução do prompt pede confirmação; esta função garante que ela aconteça
 * mesmo quando o modelo não colabora.
 */

/** Processos cuja morte derruba a sessão gráfica ou o próprio sistema. */
const PROCESSOS_CRITICOS = new Set([
  "explorer",
  "winlogon",
  "csrss",
  "lsass",
  "services",
  "smss",
  "wininit",
  "svchost",
  "system",
  "dwm",
  "ntoskrnl",
]);

export function processoCritico(alvo: string): boolean {
  const nome = String(alvo ?? "")
    .trim()
    .replace(/\.exe$/i, "")
    .toLowerCase();
  return PROCESSOS_CRITICOS.has(nome);
}

type Padrao = {
  re: RegExp;
  nivel: "destrutivo" | "critico";
  resumo: string;
  chave: string;
};

export const PADROES_DESTRUTIVOS: Padrao[] = [
  // Remoção
  { re: /\bRemove-Item\b/i, nivel: "destrutivo", resumo: "apagar arquivos ou pastas", chave: "remover" },
  { re: /\b(rm|del|erase|rmdir|rd)\b/i, nivel: "destrutivo", resumo: "apagar arquivos ou pastas", chave: "remover" },
  { re: /\bClear-Content\b/i, nivel: "destrutivo", resumo: "esvaziar o conteúdo de um arquivo", chave: "esvaziar" },

  // Escrita destrutiva
  { re: /\bSet-Content\b/i, nivel: "destrutivo", resumo: "sobrescrever um arquivo", chave: "sobrescrever" },
  { re: /\bOut-File\b/i, nivel: "destrutivo", resumo: "gravar por cima de um arquivo", chave: "sobrescrever" },
  // Redirecionamento simples sobrescreve; o duplo (>>) só acrescenta.
  { re: /(?<!>)>(?!>)/, nivel: "destrutivo", resumo: "gravar por cima de um arquivo", chave: "sobrescrever" },

  // Movimentação e renomeação. Os apelidos contam: quem digita `mv` apaga o
  // destino do mesmo jeito que quem digita `Move-Item`.
  { re: /\b(Move-Item|mi|mv|move)\b/i, nivel: "destrutivo", resumo: "mover arquivos", chave: "mover" },
  { re: /\b(Rename-Item|rni|ren|rn)\b/i, nivel: "destrutivo", resumo: "renomear arquivos", chave: "renomear" },

  // Cópia sobrescreve o destino sem avisar.
  { re: /\b(Copy-Item|copy|cp|cpi)\b/i, nivel: "destrutivo", resumo: "copiar por cima de arquivos existentes", chave: "sobrescrever" },
  // `New-Item -Force` sobre arquivo existente TRUNCA o conteúdo.
  { re: /\b(New-Item|ni)\b[^;|]*-Force\b/i, nivel: "destrutivo", resumo: "recriar um arquivo, descartando o conteúdo atual", chave: "sobrescrever" },

  // Processos
  { re: /\b(Stop-Process|spps|kill)\b/i, nivel: "destrutivo", resumo: "encerrar um processo", chave: "processo" },
  { re: /\btaskkill\b/i, nivel: "destrutivo", resumo: "encerrar um processo", chave: "processo" },

  // Serviços
  { re: /\b(Stop-Service|Set-Service|Remove-Service)\b/i, nivel: "critico", resumo: "mexer em um serviço do Windows", chave: "servico" },

  // Máquina
  { re: /\b(Stop-Computer|Restart-Computer)\b/i, nivel: "critico", resumo: "desligar ou reiniciar o computador", chave: "energia" },
  { re: /\bshutdown\b/i, nivel: "critico", resumo: "desligar ou reiniciar o computador", chave: "energia" },

  // Disco
  { re: /\b(Format-Volume|Clear-Disk|Initialize-Disk|Remove-Partition)\b/i, nivel: "critico", resumo: "formatar ou reparticionar um disco", chave: "disco" },

  // Registro
  { re: /\breg\s+delete\b/i, nivel: "critico", resumo: "apagar chave do registro", chave: "registro" },
  { re: /\b(Remove-ItemProperty|Set-ItemProperty)\b.*HK(LM|CU|CR)/i, nivel: "critico", resumo: "alterar o registro do Windows", chave: "registro" },

  // Rede e permissões
  { re: /\b(icacls|takeown)\b/i, nivel: "critico", resumo: "alterar permissões de arquivos", chave: "permissoes" },
  { re: /\bSet-ExecutionPolicy\b/i, nivel: "critico", resumo: "mudar a política de execução de scripts", chave: "politica" },
];

/**
 * O trecho é simulação de verdade?
 *
 * `-WhatIf` simula sem executar, então rebaixa o risco. Mas `-WhatIf:$false`
 * DESLIGA a simulação e ainda assim casava com a checagem antiga — bastava
 * escrever `Remove-Item ... -Force -WhatIf:$false` para apagar de verdade sem
 * pergunta nenhuma.
 */
function simulaDeVerdade(trecho: string): boolean {
  if (/-WhatIf\s*:\s*\$?(false|0)\b/i.test(trecho)) return false;
  return /-WhatIf\b/i.test(trecho);
}

/**
 * O comando INTEIRO é simulação?
 *
 * Avaliado trecho a trecho, e não sobre o texto todo: antes, um `-WhatIf` em
 * qualquer canto rebaixava tudo, então `Get-ChildItem -WhatIf; Remove-Item C:\x
 * -Recurse -Force` passava batido. Só rebaixa se cada trecho que carrega um
 * padrão destrutivo estiver, ele próprio, simulado.
 */
function tudoSimulado(texto: string, encontrados: Padrao[]): boolean {
  const trechos = texto.split(/;|\|\||&&|\||\r?\n/).filter((trecho) => trecho.trim());
  const perigosos = trechos.filter((trecho) => encontrados.some((padrao) => padrao.re.test(trecho)));

  // Se a divisão não localizou o perigo em nenhum trecho — um padrão que
  // atravessa a fronteira, por exemplo — decide pelo texto todo, sem rebaixar
  // por engano.
  if (perigosos.length === 0) return simulaDeVerdade(texto);

  return perigosos.every(simulaDeVerdade);
}

/**
 * Avalia um comando PowerShell arbitrário.
 *
 * `-Confirm:$false` NÃO rebaixa: aquilo desliga o aviso interno do próprio
 * PowerShell, que é outro portão — e justamente o sinal de que quem escreveu
 * quer evitar perguntas.
 */
export function classificarComandoPowerShell(comando: string): AvaliacaoDeRisco | null {
  const texto = String(comando ?? "");
  if (!texto.trim()) return null;

  const encontrados = PADROES_DESTRUTIVOS.filter((padrao) => padrao.re.test(texto));
  if (encontrados.length === 0) return null;

  if (tudoSimulado(texto, encontrados)) return null;

  // O mais grave manda.
  const critico = encontrados.find((padrao) => padrao.nivel === "critico");
  const escolhido = critico ?? encontrados[0];

  return {
    nivel: escolhido.nivel,
    resumo: `Isso vai ${escolhido.resumo}.`,
    impacto: encontrados.map((padrao) => padrao.resumo).join("; "),
    detalheTecnico: texto.slice(0, 600),
    chave: `powershell:${escolhido.chave}`,
  };
}

/** Encerrar processo. Alvo crítico escala para o nível mais grave. */
export function classificarEncerrarProcesso(alvo: string): AvaliacaoDeRisco {
  const nome = String(alvo ?? "").trim();
  const critico = processoCritico(nome);

  return {
    nivel: critico ? "critico" : "destrutivo",
    resumo: critico
      ? `Encerrar ${nome} pode derrubar a sessão do Windows.`
      : `Isso encerra o ${nome}.`,
    impacto: critico ? "Processo essencial do sistema" : undefined,
    chave: `encerrar_processo:${nome.toLowerCase()}`,
  };
}

/** Interpretadores e utilitários que transformam "abrir programa" em execução. */
const PROGRAMAS_PERIGOSOS = new Set([
  "cmd",
  "powershell",
  "pwsh",
  "wscript",
  "cscript",
  "mshta",
  "rundll32",
  "regsvr32",
  "reg",
  "taskkill",
  "shutdown",
  "diskpart",
  "format",
  "bcdedit",
]);

/**
 * Abrir programa parece inofensivo e não é.
 *
 * `abrir_programa("cmd", "/c rd /s /q C:\\Users\\...")` apaga a pasta sem passar
 * por classificador nenhum: é a porta lateral que contorna toda a trava do
 * curinga. Qualquer programa COM ARGUMENTOS também entra, porque argumento é
 * onde mora o comando de verdade.
 */
export function classificarAbrirPrograma(
  nome: string,
  argumentos?: string
): AvaliacaoDeRisco | null {
  const executavel = String(nome ?? "")
    .trim()
    .replace(/\.exe$/i, "")
    .toLowerCase();

  const perigoso = PROGRAMAS_PERIGOSOS.has(executavel);
  const temArgumentos = Boolean(String(argumentos ?? "").trim());

  if (!perigoso && !temArgumentos) return null;

  return {
    nivel: perigoso ? "critico" : "destrutivo",
    resumo: perigoso
      ? `Isso executa comandos pelo ${executavel}.`
      : `Isso inicia o ${executavel} com argumentos.`,
    impacto: temArgumentos ? `Argumentos: ${String(argumentos).slice(0, 200)}` : undefined,
    detalheTecnico: `${nome} ${argumentos ?? ""}`.trim().slice(0, 400),
    chave: `abrir_programa:${executavel}`,
  };
}

/**
 * Extensões que executam código em vez de abrir num visualizador.
 *
 * `.lnk` é o caso traiçoeiro: um atalho na área de trabalho tem o mesmo aspecto
 * de um documento e roda o alvo gravado dentro dele. `.url`, `.pif`, `.cpl` e
 * `.msc` seguem a mesma lógica — parecem inofensivos e não são.
 */
const EXTENSOES_EXECUTAVEIS =
  /\.(bat|cmd|ps1|psm1|exe|msi|msp|vbs|vbe|js|jse|wsf|wsh|scr|reg|com|hta|lnk|pif|cpl|msc|url|jar|py|pyw)$/i;

export function classificarAbrirCaminho(caminho: string): AvaliacaoDeRisco | null {
  const alvo = String(caminho ?? "").trim();
  if (!EXTENSOES_EXECUTAVEIS.test(alvo)) return null;

  const extensao = (EXTENSOES_EXECUTAVEIS.exec(alvo)?.[1] ?? "").toLowerCase();
  return {
    nivel: "destrutivo",
    resumo: `Isso executa um arquivo ${extensao}.`,
    impacto: "Abrir este tipo de arquivo roda código, não apenas o exibe.",
    detalheTecnico: alvo.slice(0, 400),
    chave: `abrir_caminho:${extensao}`,
  };
}
