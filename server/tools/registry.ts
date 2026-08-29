import { pareceComando } from "@shared/fala";
import type { EventoBrutoJarvis, NivelDeRisco } from "@shared/jarvisStream";
import { collectSystemStats, describeSystemForModel } from "../systemStats";
import { collectWorld, describeWorldForModel } from "../world";
import { collectDevLife, describeDevLifeForModel } from "../devLife";
import { adicionarCartao, atualizarCartao, limparCartoes, removerCartao, type TomDoCartao } from "../board";
import { resumirSaida, saidaIndicaFalha } from "../jarvis/recapitulacao";
import { recordAudit, runPowerShell, TEXTO_INTERROMPIDO } from "./shell";
import {
  classificarAbrirCaminho,
  classificarAbrirPrograma,
  classificarComandoPowerShell,
  classificarEncerrarProcesso,
} from "./risco";
import { abrirPergunta } from "../interacao/perguntas";
import { FERRAMENTAS_DE_MEMORIA } from "./memoria";
import { FERRAMENTAS_DE_COMPROMISSO } from "./compromissos";
import { FERRAMENTAS_DE_AREA_DE_TRANSFERENCIA } from "./areaDeTransferencia";
import { verATelaFerramenta } from "./tela";
import { FERRAMENTAS_DE_ARQUIVO } from "./arquivos";

/**
 * Catálogo de ferramentas do Jarvis.
 *
 * Existe um curinga (`executar_powershell`) que resolve qualquer coisa, mas o
 * catálogo nomeado não é redundante: o modelo acerta muito mais chamando uma
 * função com parâmetros validados do que redigindo a linha de comando certa na
 * primeira tentativa. O curinga é a saída para o que não estiver previsto.
 */

export type AvaliacaoDeRisco = {
  nivel: "destrutivo" | "critico";
  /** Frase falada ao pedir confirmação. */
  resumo: string;
  /** Mostrado na tela. */
  impacto?: string;
  /** Bloco técnico, nunca falado. */
  detalheTecnico?: string;
  /** "ferramenta:alvo" — escopo de um eventual "sim para todos". */
  chave: string;
};

/**
 * Contexto que o laço entrega a cada ferramenta. Único no projeto: dividir isto
 * em dois tipos faria a ferramenta ter acesso ao sinal mas não ao prazo, ou o
 * contrário, e o descasamento só apareceria em execução.
 */
export type ContextoDeExecucao = {
  execucaoId: string;
  /**
   * Põe um grupo externo no catálogo da rodada seguinte.
   *
   * Só o laço agêntico sabe montar o pedido de ferramentas, então a ferramenta
   * `habilitar_grupo` avisa por aqui em vez de mexer no catálogo global — o
   * que valeria para todas as conversas, não só para esta.
   */
  destravarGrupo?: (prefixo: string) => void;
  /** Identificador desta chamada, para casar inicio e fim na interface. */
  acaoId: string;
  sinal: AbortSignal;
  emitir: (evento: EventoBrutoJarvis) => void;
  /** Falso no caminho sem stream: perguntar recusa em vez de esperar. */
  interativo: boolean;
  autorizacoes: Set<string>;
  perguntasFeitas: number;
  /** Teto de tempo para ESTA chamada, já descontado do orçamento do turno. */
  prazoMs: number;
  /** Devolve ao orçamento o tempo parado esperando resposta humana. */
  creditarEspera: (ms: number) => void;
};

export type ResultadoFerramenta = { texto: string; ok: boolean };

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** O curinga é SEMPRE escrita. */
  efeito: "leitura" | "escrita";
  describe: (args: Record<string, any>) => string;
  /** Frase em primeira pessoa. Vira o `detalhe` do evento — texto, nunca voz. */
  narrar?: (args: Record<string, any>) => string;
  /** Não-nulo obriga confirmação antes de executar. Ligado no passo de perguntas. */
  risco?: (args: Record<string, any>) => AvaliacaoDeRisco | null;
  execute: (args: Record<string, any>, ctx: ContextoDeExecucao) => Promise<ResultadoFerramenta>;
};

export type ToolOutcome = {
  name: string;
  detail: string;
  /** O COMANDO saiu com sucesso. Pinta a interface e vira `acao_fim.ok`. */
  ok: boolean;
  /** Erro embutido numa saída de "sucesso". Alimenta a decisão de desistir. */
  suspeita: boolean;
  /** Barrada pela trava de risco, pela deduplicação ou pelo cancelamento. */
  bloqueada: boolean;
  /** Cru, para o modelo. */
  output: string;
  /** Curto, para interface e histórico. */
  resumo: string;
  duracaoMs: number;
};

const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });

/** Escapa aspas simples para interpolar com segurança numa string do PowerShell. */
function psQuote(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Prazo efetivo: o menor entre o que a ferramenta pede e o que o turno tem. */
function prazo(ctx: ContextoDeExecucao, desejado: number): number {
  return Math.max(2_000, Math.min(desejado, ctx.prazoMs));
}

/** Executa um comando repassando sinal e prazo, e converte para o contrato. */
async function shell(
  ctx: ContextoDeExecucao,
  comando: string,
  timeoutMs = 25_000
): Promise<ResultadoFerramenta> {
  const resultado = await runPowerShell(comando, {
    timeoutMs: prazo(ctx, timeoutMs),
    sinal: ctx.sinal,
  });
  return { texto: resultado.output, ok: resultado.ok };
}

/* ------------------------------------------------------------------ *
 * Sistema e processos
 * ------------------------------------------------------------------ */

const estadoDaMaquina: ToolDefinition = {
  name: "estado_da_maquina",
  description:
    "Leitura completa e atual do computador: CPU por núcleo, memória, GPU, discos, E/S, rede, bateria, threads e processos. Use quando perguntarem como está a máquina ou o que está pesando.",
  parameters: { type: "object", properties: {} },
  efeito: "leitura",
  describe: () => "leitura completa da máquina",
  narrar: () => "Vou medir a máquina.",
  execute: async () => {
    const stats = collectSystemStats();
    const extra = [
      `Uso por núcleo: ${stats.cpu.perCore
        .map((core, index) => `N${index} ${core === null ? "—" : Math.round(core) + "%"}`)
        .join(", ")}.`,
      `Threads: ${stats.cpu.threads ?? "—"}. Fila do processador: ${stats.cpu.queueLength ?? "—"}.`,
      stats.memory.committedBytes
        ? `Memória comprometida: ${(stats.memory.committedBytes / 1024 ** 3).toFixed(1)} GB.`
        : "",
      stats.hardware.biosVersion ? `BIOS: ${stats.hardware.biosVersion}.` : "",
      stats.hardware.memoryModules.length
        ? `Pentes de memória: ${stats.hardware.memoryModules
            .map((m) => `${(m.capacityBytes / 1024 ** 3).toFixed(0)} GB a ${m.speedMhz ?? "?"} MHz`)
            .join(", ")}.`
        : "",
    ].filter(Boolean);

    return { texto: `${describeSystemForModel(stats)}\n${extra.join("\n")}`, ok: true };
  },
};

const listarProcessos: ToolDefinition = {
  name: "listar_processos",
  description: "Lista os processos em execução, ordenados por consumo de memória ou de CPU.",
  parameters: {
    type: "object",
    properties: {
      ordenar_por: { type: "string", enum: ["memoria", "cpu"], description: "Critério de ordenação" },
      limite: int("Quantos processos retornar (padrão 12)"),
    },
  },
  efeito: "leitura",
  describe: (args) => `listar processos por ${args.ordenar_por ?? "memoria"}`,
  narrar: () => "Vou ver o que está rodando.",
  execute: async (args, ctx) => {
    const limite = Math.min(40, Math.max(1, Number(args.limite) || 12));
    const criterio = args.ordenar_por === "cpu" ? "CPU" : "WorkingSet64";
    return shell(
      ctx,
      `Get-Process | Sort-Object ${criterio} -Descending | Select-Object -First ${limite} ` +
        `Id,ProcessName,@{n='MemoriaMB';e={[math]::Round($_.WorkingSet64/1MB)}},@{n='CpuSeg';e={[math]::Round($_.CPU)}} | Format-Table -AutoSize | Out-String -Width 120`
    );
  },
};

const encerrarProcesso: ToolDefinition = {
  name: "encerrar_processo",
  description: "Encerra um processo pelo nome ou pelo PID.",
  parameters: {
    type: "object",
    properties: { alvo: str("Nome do processo (ex: notepad) ou o PID numérico") },
    required: ["alvo"],
  },
  efeito: "escrita",
  describe: (args) => `encerrar processo ${args.alvo}`,
  narrar: (args) => `Vou encerrar o ${args.alvo}.`,
  risco: (args) => classificarEncerrarProcesso(String(args.alvo ?? "")),
  execute: async (args, ctx) => {
    const alvo = String(args.alvo);
    const comando = /^\d+$/.test(alvo)
      ? `Stop-Process -Id ${Number(alvo)} -Force -ErrorAction Stop; 'Processo ${alvo} encerrado.'`
      : `Stop-Process -Name ${psQuote(alvo.replace(/\.exe$/i, ""))} -Force -ErrorAction Stop; 'Processo ${alvo} encerrado.'`;
    return shell(ctx, comando);
  },
};

/* ------------------------------------------------------------------ *
 * Arquivos e pastas
 * ------------------------------------------------------------------ */

const listarPasta: ToolDefinition = {
  name: "listar_pasta",
  description:
    "Lista o conteúdo de uma pasta com tamanho e data. Aceita variáveis do Windows como $env:USERPROFILE.",
  parameters: {
    type: "object",
    properties: {
      caminho: str("Caminho da pasta. Padrão: a pasta do usuário."),
      limite: int("Quantos itens listar (padrão 40)"),
    },
  },
  efeito: "leitura",
  describe: (args) => `listar ${args.caminho ?? "pasta do usuário"}`,
  narrar: (args) => `Vou abrir ${args.caminho ?? "a pasta do usuário"}.`,
  execute: async (args, ctx) => {
    const caminho = args.caminho ? psQuote(String(args.caminho)) : "$env:USERPROFILE";
    const limite = Math.min(200, Math.max(1, Number(args.limite) || 40));
    return shell(
      ctx,
      `Get-ChildItem -LiteralPath ${caminho} -ErrorAction Stop | Sort-Object LastWriteTime -Descending | ` +
        `Select-Object -First ${limite} @{n='Tipo';e={if($_.PSIsContainer){'pasta'}else{'arquivo'}}},Name,` +
        `@{n='TamanhoMB';e={if($_.PSIsContainer){''}else{[math]::Round($_.Length/1MB,2)}}},` +
        `@{n='Modificado';e={$_.LastWriteTime.ToString('dd/MM/yyyy HH:mm')}} | Format-Table -AutoSize | Out-String -Width 140`
    );
  },
};

const buscarArquivos: ToolDefinition = {
  name: "buscar_arquivos",
  description: "Procura arquivos por nome dentro de uma pasta, incluindo subpastas.",
  parameters: {
    type: "object",
    properties: {
      padrao: str("Padrão do nome, ex: *.pdf ou relatorio*"),
      pasta: str("Pasta onde procurar. Padrão: a pasta do usuário."),
      limite: int("Quantos resultados (padrão 25)"),
    },
    required: ["padrao"],
  },
  efeito: "leitura",
  describe: (args) => `buscar ${args.padrao} em ${args.pasta ?? "pasta do usuário"}`,
  narrar: (args) => `Vou varrer ${args.pasta ?? "a pasta do usuário"} atrás de ${args.padrao}.`,
  execute: async (args, ctx) => {
    const caminho = args.pasta ? psQuote(String(args.pasta)) : "$env:USERPROFILE";
    const limite = Math.min(100, Math.max(1, Number(args.limite) || 25));
    return shell(
      ctx,
      `Get-ChildItem -Path ${caminho} -Filter ${psQuote(String(args.padrao))} -File -Recurse -ErrorAction SilentlyContinue | ` +
        `Select-Object -First ${limite} @{n='TamanhoMB';e={[math]::Round($_.Length/1MB,2)}},` +
        `@{n='Modificado';e={$_.LastWriteTime.ToString('dd/MM/yyyy')}},FullName | Format-Table -AutoSize | Out-String -Width 160`,
      40_000
    );
  },
};

const usoDoDisco: ToolDefinition = {
  name: "uso_do_disco",
  description:
    "Mostra quais subpastas ocupam mais espaço dentro de um caminho. Use para descobrir o que está enchendo o disco.",
  parameters: {
    type: "object",
    properties: { caminho: str("Pasta a analisar. Padrão: a pasta do usuário.") },
  },
  efeito: "leitura",
  describe: (args) => `medir espaço em ${args.caminho ?? "pasta do usuário"}`,
  narrar: (args) => `Vou medir o espaço em ${args.caminho ?? "sua pasta"}. Leva alguns segundos.`,
  execute: async (args, ctx) => {
    const caminho = args.caminho ? psQuote(String(args.caminho)) : "$env:USERPROFILE";
    return shell(
      ctx,
      `Get-ChildItem -LiteralPath ${caminho} -Directory -ErrorAction Stop | ForEach-Object { ` +
        `$tamanho = (Get-ChildItem -LiteralPath $_.FullName -File -Recurse -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum; ` +
        `[PSCustomObject]@{ Pasta = $_.Name; GB = [math]::Round($tamanho/1GB, 2) } } | ` +
        `Sort-Object GB -Descending | Select-Object -First 15 | Format-Table -AutoSize | Out-String -Width 100`,
      60_000
    );
  },
};

const abrirCaminho: ToolDefinition = {
  name: "abrir_caminho",
  description: "Abre um arquivo ou pasta no programa padrão do Windows.",
  parameters: {
    type: "object",
    properties: { caminho: str("Caminho do arquivo ou pasta") },
    required: ["caminho"],
  },
  efeito: "escrita",
  describe: (args) => `abrir ${args.caminho}`,
  narrar: (args) => `Vou abrir ${args.caminho}.`,
  risco: (args) => classificarAbrirCaminho(String(args.caminho ?? "")),
  execute: async (args, ctx) =>
    shell(ctx, `Invoke-Item -LiteralPath ${psQuote(String(args.caminho))} -ErrorAction Stop; 'Aberto.'`),
};

/* ------------------------------------------------------------------ *
 * Programas, sites e sistema
 * ------------------------------------------------------------------ */

const abrirPrograma: ToolDefinition = {
  name: "abrir_programa",
  description:
    "Inicia um programa instalado pelo nome do executável, ex: notepad, calc, spotify, chrome.",
  parameters: {
    type: "object",
    properties: {
      nome: str("Nome do executável, sem caminho"),
      argumentos: str("Argumentos opcionais"),
    },
    required: ["nome"],
  },
  efeito: "escrita",
  describe: (args) => `abrir programa ${args.nome}`,
  narrar: (args) => `Vou abrir o ${args.nome}.`,
  risco: (args) =>
    classificarAbrirPrograma(String(args.nome ?? ""), args.argumentos ? String(args.argumentos) : undefined),
  execute: async (args, ctx) => {
    const argumentos = args.argumentos ? ` -ArgumentList ${psQuote(String(args.argumentos))}` : "";
    return shell(
      ctx,
      `Start-Process ${psQuote(String(args.nome))}${argumentos} -ErrorAction Stop; 'Programa iniciado.'`
    );
  },
};

const abrirSite: ToolDefinition = {
  name: "abrir_site",
  description: "Abre um endereço no navegador padrão.",
  parameters: {
    type: "object",
    properties: { url: str("Endereço completo, começando com http") },
    required: ["url"],
  },
  efeito: "escrita",
  describe: (args) => `abrir site ${args.url}`,
  narrar: () => "Vou abrir no navegador.",
  execute: async (args, ctx) => {
    const url = String(args.url);
    if (!/^https?:\/\//i.test(url)) {
      return { texto: "Endereço inválido: precisa começar com http:// ou https://", ok: false };
    }
    return shell(ctx, `Start-Process ${psQuote(url)}; 'Site aberto.'`);
  },
};

const controlarVolume: ToolDefinition = {
  name: "controlar_volume",
  description: "Aumenta, diminui ou silencia o som do sistema. Cada passo equivale a 2% do volume.",
  parameters: {
    type: "object",
    properties: {
      acao: { type: "string", enum: ["aumentar", "diminuir", "mudo"], description: "O que fazer" },
      passos: int("Quantos passos de 2% (padrão 5). Ignorado no mudo."),
    },
    required: ["acao"],
  },
  efeito: "escrita",
  describe: (args) => `volume: ${args.acao}`,
  execute: async (args, ctx) => {
    // O Windows não expõe cmdlet de volume; o caminho sem dependência externa é
    // enviar as teclas de mídia, e cada uma vale um passo de 2%.
    const teclas: Record<string, number> = { aumentar: 175, diminuir: 174, mudo: 173 };
    const tecla = teclas[String(args.acao)];
    if (!tecla) return { texto: "Ação inválida.", ok: false };
    const passos = args.acao === "mudo" ? 1 : Math.min(50, Math.max(1, Number(args.passos) || 5));
    return shell(
      ctx,
      `$w = New-Object -ComObject WScript.Shell; 1..${passos} | ForEach-Object { $w.SendKeys([char]${tecla}) }; 'Volume ajustado.'`
    );
  },
};

const travarTela: ToolDefinition = {
  name: "travar_tela",
  description: "Bloqueia a sessão do Windows, exigindo senha para voltar.",
  parameters: { type: "object", properties: {} },
  efeito: "escrita",
  describe: () => "travar a tela",
  narrar: () => "Vou bloquear a tela.",
  execute: async (args, ctx) =>
    shell(ctx, `rundll32.exe user32.dll,LockWorkStation; 'Tela bloqueada.'`),
};

/* ------------------------------------------------------------------ *
 * Mundo, projetos e painel
 * ------------------------------------------------------------------ */

const verMundo: ToolDefinition = {
  name: "ver_mundo",
  description:
    "Clima e previsão, cotação de dólar, euro e bitcoin, e as manchetes do momento. Dados reais e atuais.",
  parameters: { type: "object", properties: {} },
  efeito: "leitura",
  describe: () => "clima, câmbio e manchetes",
  narrar: () => "Vou conferir lá fora.",
  execute: async () => {
    const texto = describeWorldForModel(collectWorld());
    return {
      texto: texto || "As fontes externas ainda não responderam. Tente de novo em instantes.",
      ok: Boolean(texto),
    };
  },
};

const verProjetos: ToolDefinition = {
  name: "ver_projetos",
  description:
    "Estado dos repositórios git desta máquina: ramo, arquivos alterados, arquivos novos e commits sem enviar. Também as portas TCP em escuta.",
  parameters: { type: "object", properties: {} },
  efeito: "leitura",
  describe: () => "estado dos repositórios e portas",
  narrar: () => "Vou olhar seus projetos.",
  execute: async () => {
    const texto = describeDevLifeForModel(collectDevLife());
    return {
      texto: texto || "A varredura de repositórios ainda não terminou. Tente de novo em instantes.",
      ok: Boolean(texto),
    };
  },
};

const mostrarNoPainel: ToolDefinition = {
  name: "mostrar_no_painel",
  description:
    "Deixa um cartão na janela do painel — a área de trabalho do dono. USO OBRIGATÓRIO para: resultado de pesquisa, lista com 3+ itens, comparação, números medidos, plano ou passo a passo, tabela, código ou comando, link. A voz resume; o painel guarda o detalhe. Escolha o TIPO certo de cada item: metrica para número com rótulo, progresso para percentual, passo para tarefa marcável, tabela para comparação, lista para enumeração, link para endereço, codigo para comando ou trecho, texto para prosa curta. Depois, diga em uma frase que está na tela.",
  parameters: {
    type: "object",
    properties: {
      titulo: str("Título curto do cartão"),
      subtitulo: str("Uma linha de contexto sob o título, opcional"),
      itens: {
        type: "array",
        description: "Itens do cartão, cada um com um tipo",
        items: {
          type: "object",
          properties: {
            tipo: {
              type: "string",
              enum: ["texto", "metrica", "progresso", "link", "lista", "passo", "tabela", "codigo", "separador"],
            },
            rotulo: str("Rótulo curto (texto, metrica, progresso, link, lista, separador)"),
            texto: str("Conteúdo (texto, progresso, link, passo, codigo)"),
            valor: str("metrica: o valor já formatado, ex. '220'. progresso: número de 0 a 100"),
            unidade: str("metrica: unidade, ex. 'GB', '%', 'ms'"),
            tendencia: { type: "string", enum: ["sobe", "desce", "estavel"], description: "metrica" },
            tom: { type: "string", enum: ["neutro", "bom", "atencao", "alerta"], description: "metrica" },
            url: str("link: endereço completo com https://"),
            itens: { type: "array", items: { type: "string" }, description: "lista: as linhas" },
            feito: { type: "boolean", description: "passo: já concluído?" },
            colunas: { type: "array", items: { type: "string" }, description: "tabela: cabeçalhos" },
            linhas: {
              type: "array",
              items: { type: "array", items: { type: "string" } },
              description: "tabela: linhas, cada uma com uma célula por coluna",
            },
            linguagem: str("codigo: ex. 'powershell', 'ts'"),
          },
          required: ["tipo"],
        },
      },
      tom: {
        type: "string",
        enum: ["neutro", "bom", "atencao", "alerta"],
        description: "Cor da borda conforme a natureza do conteúdo",
      },
      nota: str("Observação de rodapé, opcional"),
      largura: { type: "string", enum: ["normal", "largo"], description: "largo ocupa duas colunas" },
      fixado: { type: "boolean", description: "Fixado não cai quando novos entram. Use para o que ele vai consultar por dias." },
    },
    required: ["titulo", "itens"],
  },
  efeito: "escrita",
  describe: (args) => `painel: ${args.titulo}`,
  narrar: () => "Vou deixar isso no painel.",
  execute: async (args) => {
    const itens = Array.isArray(args.itens) ? args.itens : [];
    const cartao = adicionarCartao({
      titulo: String(args.titulo ?? ""),
      subtitulo: args.subtitulo ? String(args.subtitulo) : null,
      itens,
      tom: (args.tom as TomDoCartao) ?? "neutro",
      nota: args.nota ? String(args.nota) : null,
      largura: args.largura === "largo" ? "largo" : "normal",
      fixado: Boolean(args.fixado),
    });
    if (!cartao) {
      return { texto: "Nenhum item tinha forma válida. Cada item precisa de tipo e do conteúdo daquele tipo.", ok: false };
    }
    return {
      texto: `Cartão #${cartao.id} "${cartao.titulo}" no painel, com ${cartao.itens.length} item(ns).`,
      ok: true,
    };
  },
};

const atualizarPainel: ToolDefinition = {
  name: "atualizar_painel",
  description:
    "Mexe num cartão que já está no painel: marca um passo como feito, fixa ou solta, troca a nota, ou remove o cartão. O número do cartão está no resumo do painel que você recebe.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "integer", description: "Número do cartão" },
      passo: {
        type: "object",
        properties: {
          indice: { type: "integer", description: "Posição do item, começando em 0" },
          feito: { type: "boolean" },
        },
        required: ["indice", "feito"],
      },
      fixado: { type: "boolean" },
      nota: str("Nova nota de rodapé"),
      remover: { type: "boolean", description: "Verdadeiro para tirar o cartão do painel" },
    },
    required: ["id"],
  },
  efeito: "escrita",
  describe: (args) => `painel #${args.id}: ${args.remover ? "remover" : "atualizar"}`,
  narrar: () => "Vou ajustar o painel.",
  execute: async (args) => {
    const id = Number(args.id);
    if (args.remover) {
      return removerCartao(id)
        ? { texto: `Cartão #${id} removido.`, ok: true }
        : { texto: `Não há cartão #${id}.`, ok: false };
    }
    const passo = args.passo as { indice?: unknown; feito?: unknown } | undefined;
    const cartao = atualizarCartao(id, {
      ...(typeof args.fixado === "boolean" ? { fixado: args.fixado } : {}),
      ...(args.nota !== undefined ? { nota: String(args.nota) } : {}),
      ...(passo && typeof passo.indice === "number"
        ? { passo: { indice: passo.indice, feito: Boolean(passo.feito) } }
        : {}),
    });
    return cartao
      ? { texto: `Cartão #${id} atualizado.`, ok: true }
      : { texto: `Não há cartão #${id}.`, ok: false };
  },
};

/**
 * A válvula de escape do filtro de ferramentas.
 *
 * O catálogo externo é filtrado por assunto porque mandar as 64 a cada rodada
 * levava uma saudação a 131 segundos. O preço é errar às vezes para menos — e
 * aí o modelo não VIA a ferramenta e respondia "não tenho acesso à sua
 * agenda", que é mentira e é a cara da burrice.
 *
 * Com isto ele pede o grupo e continua na rodada seguinte. Custa ~200 bytes de
 * esquema permanente em vez dos 33 KB da agenda.
 */
const habilitarGrupo: ToolDefinition = {
  name: "habilitar_grupo",
  description:
    "Destrava um grupo de ferramentas externas que não está no seu catálogo agora. Use quando precisar de agenda, e-mail ou GitHub e não encontrar a ferramenta. Na rodada seguinte o grupo inteiro estará disponível. NUNCA diga ao Senhor que não tem acesso a algo que isto destrava.",
  parameters: {
    type: "object",
    properties: {
      grupo: { type: "string", enum: ["agenda", "email", "github"], description: "Qual grupo" },
    },
    required: ["grupo"],
  },
  efeito: "leitura",
  describe: (args) => `destravar ${args.grupo}`,
  narrar: () => "Vou buscar a ferramenta certa.",
  execute: async (args, ctx) => {
    const grupo = String(args.grupo ?? "");
    if (!["agenda", "email", "github"].includes(grupo)) {
      return { texto: `Não existe o grupo "${grupo}". Há agenda, email e github.`, ok: false };
    }
    ctx.destravarGrupo?.(`${grupo}_`);
    return {
      texto: `O grupo ${grupo} está disponível a partir da próxima rodada. Chame a ferramenta agora.`,
      ok: true,
    };
  },
};

const limparPainel: ToolDefinition = {
  name: "limpar_painel",
  description: "Remove todos os cartões que você deixou no painel.",
  parameters: { type: "object", properties: {} },
  efeito: "escrita",
  describe: () => "limpar cartões do painel",
  execute: async () => {
    const quantidade = limparCartoes();
    return { texto: `${quantidade} cartão(ões) removido(s) do painel.`, ok: true };
  },
};

/* ------------------------------------------------------------------ *
 * Web
 * ------------------------------------------------------------------ */

const buscarNaWeb: ToolDefinition = {
  name: "buscar_na_web",
  description:
    "Pesquisa na internet e devolve títulos, trechos e endereços. Use para fatos atuais, preços, notícias e qualquer coisa fora do seu conhecimento.",
  parameters: {
    type: "object",
    properties: { consulta: str("O que pesquisar") },
    required: ["consulta"],
  },
  efeito: "leitura",
  describe: (args) => `buscar na web: ${args.consulta}`,
  narrar: (args) => `Vou pesquisar sobre ${args.consulta}.`,
  execute: async (args, ctx) => {
    const consulta = String(args.consulta ?? "").trim();
    if (!consulta) return { texto: "Consulta vazia.", ok: false };

    let html: string;
    try {
      const resposta = await fetch(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(consulta)}`,
        {
          headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
          signal: AbortSignal.any([ctx.sinal, AbortSignal.timeout(prazo(ctx, 15_000))]),
        }
      );
      if (!resposta.ok) return { texto: `A busca falhou (HTTP ${resposta.status}).`, ok: false };
      html = await resposta.text();
    } catch {
      if (ctx.sinal.aborted) return { texto: TEXTO_INTERROMPIDO, ok: false };
      return { texto: "Não foi possível alcançar o serviço de busca.", ok: false };
    }

    const semTags = (valor: string) =>
      valor
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/\s+/g, " ")
        .trim();

    // O DuckDuckGo entrega os links por um redirecionador; o destino real vem no
    // parâmetro uddg.
    const urlReal = (href: string) => {
      const achado = /[?&]uddg=([^&]+)/.exec(href);
      return achado ? decodeURIComponent(achado[1]) : href;
    };

    const resultados: string[] = [];
    const blocoRe =
      /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]*class="result__a"|$)/g;

    let bloco: RegExpExecArray | null;
    while ((bloco = blocoRe.exec(html)) && resultados.length < 6) {
      const titulo = semTags(bloco[2]);
      const url = urlReal(bloco[1]);
      const trecho = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(bloco[3]);
      const resumo = trecho ? semTags(trecho[1]).slice(0, 260) : "";
      if (titulo) resultados.push(`${resultados.length + 1}. ${titulo}\n   ${resumo}\n   ${url}`);
    }

    if (resultados.length === 0) {
      return { texto: "A busca não retornou resultados legíveis.", ok: false };
    }
    return { texto: `Resultados para "${consulta}":\n\n${resultados.join("\n\n")}`, ok: true };
  },
};

/* ------------------------------------------------------------------ *
 * Perguntar ao dono
 * ------------------------------------------------------------------ */

const perguntarAoUsuario: ToolDefinition = {
  name: "perguntar_ao_usuario",
  description:
    "Faz UMA pergunta ao Senhor Edson e espera a resposta. Use apenas para o que a máquina não pode responder: ambiguidade real de alvo depois de já ter procurado, ou um destino, nome ou valor que só ele sabe. Nunca use para pedir permissão de ação destrutiva — isso o sistema pede sozinho.",
  parameters: {
    type: "object",
    properties: {
      pergunta: str("A pergunta, curta e objetiva. Será falada em voz alta."),
      opcoes: {
        type: "array",
        description: "De 2 a 8 alternativas, quando houver escolha fechada",
        items: {
          type: "object",
          properties: {
            id: str("Identificador curto e único"),
            rotulo: str("O que aparece no botão"),
            detalhe: str("Informação auxiliar, como o caminho completo"),
          },
          required: ["id", "rotulo"],
        },
      },
    },
    required: ["pergunta"],
  },
  efeito: "leitura",
  describe: (args) => `perguntar: ${String(args.pergunta ?? "").slice(0, 80)}`,
  execute: async (args, ctx) => {
    const opcoes = Array.isArray(args.opcoes)
      ? args.opcoes.map((opcao: any) => ({
          id: String(opcao?.id ?? ""),
          rotulo: String(opcao?.rotulo ?? ""),
          detalhe: opcao?.detalhe ? String(opcao.detalhe) : undefined,
        }))
      : [];

    const resultado = await abrirPergunta({
      execucaoId: ctx.execucaoId,
      tipo: opcoes.length > 0 ? "escolha" : "texto",
      pergunta: String(args.pergunta ?? ""),
      opcoes,
      aceitaTextoLivre: true,
      emitir: ctx.emitir,
      sinal: ctx.sinal,
      interativo: ctx.interativo,
    });

    // O tempo parado esperando gente não conta contra o orçamento da tarefa.
    ctx.creditarEspera(resultado.esperouMs);

    if (resultado.desfecho === "respondida") {
      return { texto: `O Senhor Edson respondeu: ${resultado.texto}`, ok: true };
    }
    if (resultado.desfecho === "expirada") {
      return {
        texto: "Ele não respondeu a tempo. Decida com o que você já tem ou pare e relate.",
        ok: false,
      };
    }
    return {
      texto:
        resultado.desfecho === "cancelada"
          ? resultado.texto ?? "Ele preferiu não responder."
          : "A pergunta foi encerrada porque a execução terminou.",
      ok: false,
    };
  },
};

/* ------------------------------------------------------------------ *
 * Curinga
 * ------------------------------------------------------------------ */

const executarPowerShell: ToolDefinition = {
  name: "executar_powershell",
  description:
    "Executa um comando PowerShell arbitrário na máquina e devolve a saída. Use quando nenhuma ferramenta específica resolver. Prefira comandos que devolvam texto legível.",
  parameters: {
    type: "object",
    properties: {
      comando: str("O comando PowerShell"),
      motivo: str("Em uma frase, por que este comando atende ao pedido"),
    },
    required: ["comando"],
  },
  efeito: "escrita",
  describe: (args) => String(args.comando).replace(/\s+/g, " ").slice(0, 140),
  // O motivo é falado; se o modelo pôs o comando nele, sai a frase neutra.
  narrar: (args) =>
    args.motivo && !pareceComando(String(args.motivo)) ? String(args.motivo) : "Vou rodar um comando.",
  risco: (args) => classificarComandoPowerShell(String(args.comando ?? "")),
  execute: async (args, ctx) => shell(ctx, String(args.comando)),
};

/* ------------------------------------------------------------------ */

export const TOOLS: ToolDefinition[] = [
  estadoDaMaquina,
  listarProcessos,
  encerrarProcesso,
  listarPasta,
  buscarArquivos,
  usoDoDisco,
  abrirCaminho,
  abrirPrograma,
  abrirSite,
  controlarVolume,
  travarTela,
  verMundo,
  verProjetos,
  mostrarNoPainel,
  atualizarPainel,
  habilitarGrupo,
  limparPainel,
  buscarNaWeb,
  perguntarAoUsuario,
  ...FERRAMENTAS_DE_MEMORIA,
  ...FERRAMENTAS_DE_COMPROMISSO,
  ...FERRAMENTAS_DE_AREA_DE_TRANSFERENCIA,
  verATelaFerramenta,
  ...FERRAMENTAS_DE_ARQUIVO,
  executarPowerShell,
];

const POR_NOME = new Map(TOOLS.map((tool) => [tool.name, tool]));

/**
 * Acrescenta ferramentas ao catálogo em tempo de execução.
 *
 * Existe para a ponte MCP: os servidores externos só revelam o que sabem fazer
 * depois de conectados, então o catálogo não pode ser fechado no arranque.
 *
 * Nome repetido é RECUSADO em vez de sobrescrever: duas ferramentas com o mesmo
 * nome fariam o modelo chamar uma e receber a outra, e o erro apareceria como
 * comportamento inexplicável, não como conflito.
 */
export function registrarFerramentas(novas: ToolDefinition[]): number {
  let aceitas = 0;

  for (const ferramenta of novas) {
    if (POR_NOME.has(ferramenta.name)) {
      console.warn(`[Ferramentas] "${ferramenta.name}" já existe; a nova foi ignorada.`);
      continue;
    }
    TOOLS.push(ferramenta);
    POR_NOME.set(ferramenta.name, ferramenta);
    aceitas += 1;
  }

  return aceitas;
}

/**
 * Ferramentas que não precisam declarar `risco()`.
 *
 * A lista é explícita para que a PRÓXIMA ferramenta adicionada falhe alto em
 * vez de passar em branco pela trava de confirmação.
 */
export const ISENTAS_DE_RISCO = new Set([
  "estado_da_maquina",
  "listar_processos",
  "listar_pasta",
  "buscar_arquivos",
  "uso_do_disco",
  "abrir_site",
  "controlar_volume",
  "travar_tela",
  "ver_mundo",
  "ver_projetos",
  "mostrar_no_painel",
  "limpar_painel",
  // Só destrava catálogo. Não toca na máquina nem em conta nenhuma.
  "habilitar_grupo",
  // Mexe só no painel: marcar passo, fixar, remover cartão. Nada na máquina.
  "atualizar_painel",
  "buscar_na_web",
  "perguntar_ao_usuario",
  // Memória não toca a máquina; o filtro de segredos é a guarda dela.
  "lembrar",
  "recordar",
  "esquecer",
  // Leitura de arquivo é leitura: o segredo é redigido, não repassado.
  "ler_arquivo",
  // A área de transferência não é destino de trabalho: sobrescrevê-la não
  // apaga nada que só exista ali, e a leitura passa pelo filtro de segredos.
  "ler_area_de_transferencia",
  "escrever_area_de_transferencia",
  // Marcar compromisso não muda nada fora do Jarvis, e cancelar o que ele
  // próprio marcou a pedido do dono é justamente o propósito.
  "criar_lembrete",
  "criar_rotina",
  "criar_vigia",
  "listar_compromissos",
  "cancelar_compromisso",
]);

/** Ferramentas de escrita que ainda não têm classificador de risco ligado. */
export function ferramentasSemRisco(): string[] {
  return TOOLS.filter(
    (tool) => !tool.risco && !ISENTAS_DE_RISCO.has(tool.name)
  ).map((tool) => tool.name);
}

/** Todos os nomes do catálogo, para quem precisa decidir o que enviar. */
export function nomesDasFerramentas(): string[] {
  return TOOLS.map((tool) => tool.name);
}

/**
 * Formato que o endpoint de chat espera no campo `tools`.
 *
 * `permitidas` filtra o que vai no pedido. Mandar o catálogo inteiro a cada
 * rodada foi medido em 60 KB de esquema e levou uma saudação a 131 segundos.
 */
export function toolSchemas(permitidas?: readonly string[]) {
  const lista = permitidas ? TOOLS.filter((tool) => permitidas.includes(tool.name)) : TOOLS;
  return lista.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/** Frase em primeira pessoa para o `detalhe` do evento de início. */
export function narrarChamada(name: string, args: Record<string, unknown>): string {
  const tool = POR_NOME.get(name);
  if (!tool) return name;
  if (tool.narrar) {
    try {
      return tool.narrar(args);
    } catch {
      /* cai para o describe */
    }
  }
  return tool.describe(args);
}

export function obterFerramenta(name: string): ToolDefinition | undefined {
  return POR_NOME.get(name);
}

/**
 * Frases de anúncio que não dependem dos argumentos.
 *
 * São as que valem a pena sintetizar antes de precisar: sempre idênticas, e é
 * justamente com elas que o Jarvis abre a ação. Chamar `narrar` sem argumentos e
 * descartar o que estourar separa as fixas das que interpolam alvo.
 */
export function frasesFixasDeAnuncio(): string[] {
  const frases = new Set<string>();

  for (const tool of TOOLS) {
    if (!tool.narrar) continue;
    try {
      const frase = tool.narrar({});
      // Com argumento faltando, a interpolação vira "undefined" no texto.
      if (frase && !/undefined|null/.test(frase)) frases.add(frase);
    } catch {
      /* depende de argumento: não dá para pré-aquecer */
    }
  }

  return [...frases];
}

/**
 * Executa uma ferramenta pelo nome.
 *
 * `ok` e `suspeita` são conceitos diferentes e não cabem no mesmo booleano.
 * `buscar_arquivos` roda com `-ErrorAction SilentlyContinue`: o processo sai
 * zero e a saída vem vazia. Isso é `ok: true, suspeita: true`. Escrever os dois
 * no mesmo campo faria a interface mentir em verde, ou a desistência nunca
 * disparar.
 */
export async function invokeTool(
  name: string,
  rawArgs: string,
  ctx: ContextoDeExecucao
): Promise<ToolOutcome> {
  const inicio = Date.now();
  const vazio = (extra: Partial<ToolOutcome>): ToolOutcome => ({
    name,
    detail: name,
    ok: false,
    suspeita: false,
    bloqueada: false,
    output: "",
    resumo: "",
    duracaoMs: Date.now() - inicio,
    ...extra,
  });

  const tool = POR_NOME.get(name);
  if (!tool) {
    return vazio({
      output: `Ferramenta desconhecida: ${name}`,
      resumo: "ferramenta desconhecida",
    });
  }

  let args: Record<string, unknown> = {};
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return vazio({
      detail: tool.name,
      output: "Os parâmetros não vieram em JSON válido.",
      resumo: "parâmetros inválidos",
    });
  }

  const detail = tool.describe(args);

  if (ctx.sinal.aborted) {
    return vazio({ detail, bloqueada: true, output: TEXTO_INTERROMPIDO, resumo: "interrompida" });
  }

  /*
   * A TRAVA.
   *
   * Aqui, e não no prompt: a instrução pede que o modelo confirme, esta trava
   * garante que a confirmação aconteça mesmo quando ele não colabora. Enquanto
   * a promessa não resolve, `execute` não roda — e todo desfecho que não seja
   * autorização explícita bloqueia a ação.
   */
  const avaliacao = tool.risco?.(args) ?? null;
  if (avaliacao && !ctx.autorizacoes.has(avaliacao.chave)) {
    const confirmacao = await abrirPergunta({
      execucaoId: ctx.execucaoId,
      tipo: "confirmacao",
      pergunta: `${avaliacao.resumo} Confirma?`,
      opcoes: [
        { id: "sim", rotulo: "Confirmar", perigo: true },
        { id: "nao", rotulo: "Cancelar" },
      ],
      aceitaTextoLivre: false,
      nivel: avaliacao.nivel,
      impacto: avaliacao.impacto,
      detalheTecnico: avaliacao.detalheTecnico,
      ferramenta: name,
      emitir: ctx.emitir,
      sinal: ctx.sinal,
      interativo: ctx.interativo,
    });

    ctx.creditarEspera(confirmacao.esperouMs);

    const autorizado =
      confirmacao.desfecho === "respondida" && confirmacao.opcaoId === "sim";

    if (!autorizado) {
      const motivo =
        confirmacao.desfecho === "expirada"
          ? "O Senhor Edson não confirmou a tempo, então a ação NÃO foi executada."
          : confirmacao.desfecho === "abortada"
            ? "A execução foi encerrada antes da confirmação; a ação NÃO aconteceu."
            : `O Senhor Edson não autorizou. A ação NÃO foi executada.${
                confirmacao.desfecho === "cancelada" && confirmacao.texto
                  ? ` Ele disse: ${confirmacao.texto}`
                  : ""
              } Aceite e não tente outro caminho para fazer o mesmo.`;

      return {
        name,
        detail,
        ok: false,
        suspeita: false,
        bloqueada: true,
        output: motivo,
        resumo: "não autorizada",
        duracaoMs: Date.now() - inicio,
      };
    }
  }

  // O evento de início sai DEPOIS da confirmação: emiti-lo antes faria a
  // interface mostrar "executando" durante o tempo em que o dono está apenas
  // pensando, e a duração medida incluiria essa espera.
  ctx.emitir({
    tipo: "acao_inicio",
    acaoId: ctx.acaoId,
    ferramenta: name,
    detalhe: narrarChamada(name, args),
    rodada: 0,
  });

  try {
    const resultado = await tool.execute(args, ctx);
    const duracaoMs = Date.now() - inicio;

    // Cancelamento no meio vira BLOQUEADA, nunca falha. Caso contrário o turno
    // seguinte começa com o modelo achando que o comando falhou tecnicamente, e
    // a persona o manda tentar rota alternativa: reexecuta o que foi interrompido.
    if (ctx.sinal.aborted || resultado.texto === TEXTO_INTERROMPIDO) {
      recordAudit({ at: new Date(), tool: name, detail, ok: false, durationMs: duracaoMs });
      return {
        name,
        detail,
        ok: false,
        suspeita: false,
        bloqueada: true,
        output: TEXTO_INTERROMPIDO,
        resumo: "interrompida",
        duracaoMs,
      };
    }

    recordAudit({ at: new Date(), tool: name, detail, ok: resultado.ok, durationMs: duracaoMs });

    return {
      name,
      detail,
      ok: resultado.ok,
      suspeita: resultado.ok && saidaIndicaFalha(resultado.texto),
      bloqueada: false,
      output: resultado.texto,
      resumo: resumirSaida(resultado.texto, resultado.ok),
      duracaoMs,
    };
  } catch (error) {
    const duracaoMs = Date.now() - inicio;

    if (ctx.sinal.aborted) {
      return {
        name,
        detail,
        ok: false,
        suspeita: false,
        bloqueada: true,
        output: TEXTO_INTERROMPIDO,
        resumo: "interrompida",
        duracaoMs,
      };
    }

    const mensagem = error instanceof Error ? error.message : String(error);
    recordAudit({ at: new Date(), tool: name, detail, ok: false, durationMs: duracaoMs });

    return {
      name,
      detail,
      ok: false,
      suspeita: false,
      bloqueada: false,
      output: `Falha ao executar: ${mensagem}`,
      resumo: resumirSaida(mensagem, false),
      duracaoMs,
    };
  }
}
