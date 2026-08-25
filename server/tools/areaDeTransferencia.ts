import type { ToolDefinition } from "./registry";
import { runPowerShell } from "./shell";
import { inspecionarSegredo } from "../memoria/filtroDeSegredos";

/**
 * Área de transferência.
 *
 * É o comando mais natural que existe num computador: "resume o que eu copiei",
 * "põe isso na área de transferência para eu colar". Sem isto, o Senhor Edson
 * precisa colar o texto na conversa à mão — que é justamente o trabalho que ele
 * queria não ter.
 *
 * A leitura passa pelo FILTRO DE SEGREDOS antes de qualquer coisa. Não é
 * paranoia: a área de transferência de um desenvolvedor guarda senha, token e
 * string de conexão o tempo todo, e ela seria despachada para o provedor de IA
 * sem ninguém decidir nada. Melhor recusar e avisar do que vazar em silêncio.
 */

const MAX_CHARS = 8000;

export const lerAreaDeTransferencia: ToolDefinition = {
  name: "ler_area_de_transferencia",
  description:
    "Lê o texto que está na área de transferência do Windows. Use quando ele disser 'o que eu copiei', 'resume isso que copiei', 'traduz o que está na área de transferência' — ou quando se referir a algo sem dizer qual, logo depois de copiar.",
  parameters: { type: "object", properties: {} },
  efeito: "leitura",
  describe: () => "ler a área de transferência",
  narrar: () => "Vou ver o que o senhor copiou.",
  execute: async (_args, ctx) => {
    const resultado = await runPowerShell("Get-Clipboard -Raw", {
      timeoutMs: 8_000,
      sinal: ctx.sinal,
    });

    if (!resultado.ok) {
      return { texto: "Não consegui ler a área de transferência.", ok: false };
    }

    const conteudo = resultado.output.trim();
    if (!conteudo || conteudo === "(sem saída)") {
      return { texto: "A área de transferência está vazia.", ok: true };
    }

    /*
     * A recusa vem ANTES de o conteúdo entrar na resposta da ferramenta, porque
     * o que a ferramenta devolve vai direto para o provedor. Descrever o que foi
     * bloqueado, sem mostrar, é o que permite ao Jarvis explicar em vez de
     * apenas falhar.
     */
    const veredito = inspecionarSegredo(conteudo, { limitarTamanho: false });
    if (!veredito.permitido) {
      return {
        texto:
          `O que está copiado ${veredito.motivo}, então não vou repassá-lo. ` +
          "Diga ao Senhor Edson o que foi detectado e pergunte se ele quer prosseguir de outro jeito.",
        ok: false,
      };
    }

    const cortado = conteudo.length > MAX_CHARS;
    return {
      texto:
        `Na área de transferência (${conteudo.length} caracteres):\n\n` +
        conteudo.slice(0, MAX_CHARS) +
        (cortado ? "\n\n… (cortado)" : ""),
      ok: true,
    };
  },
};

export const escreverAreaDeTransferencia: ToolDefinition = {
  name: "escrever_area_de_transferencia",
  description:
    "Coloca um texto na área de transferência, pronto para ele colar onde quiser. Use quando ele pedir algo para usar em outro lugar: um comando, um trecho de código, um texto reescrito, um resumo.",
  parameters: {
    type: "object",
    properties: { texto: { type: "string", description: "O texto a copiar, já pronto para colar" } },
    required: ["texto"],
  },
  efeito: "escrita",
  describe: (args) => `copiar ${String(args.texto ?? "").length} caracteres`,
  narrar: () => "Vou deixar isso copiado.",
  execute: async (args, ctx) => {
    const texto = String(args.texto ?? "");
    if (!texto.trim()) return { texto: "Não havia texto para copiar.", ok: false };

    /*
     * O texto vai por arquivo temporário, e não interpolado no comando: um
     * trecho de código com aspas, cifrão ou quebra de linha viraria comando
     * quebrado — ou, pior, comando diferente do pretendido.
     */
    const arquivo = `$env:TEMP\\jarvis-copiar.txt`;
    const base64 = Buffer.from(texto, "utf8").toString("base64");

    const comando = [
      `$bytes = [Convert]::FromBase64String('${base64}')`,
      `[IO.File]::WriteAllBytes("${arquivo}", $bytes)`,
      `Get-Content -Raw -Encoding UTF8 "${arquivo}" | Set-Clipboard`,
      `Remove-Item "${arquivo}" -Force -ErrorAction SilentlyContinue`,
    ].join("; ");

    const resultado = await runPowerShell(comando, { timeoutMs: 8_000, sinal: ctx.sinal });
    return resultado.ok
      ? { texto: `Copiado. São ${texto.length} caracteres, prontos para colar.`, ok: true }
      : { texto: `Não consegui copiar: ${resultado.output.slice(0, 160)}`, ok: false };
  },
};

export const FERRAMENTAS_DE_AREA_DE_TRANSFERENCIA: ToolDefinition[] = [
  lerAreaDeTransferencia,
  escreverAreaDeTransferencia,
];
