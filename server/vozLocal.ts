import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Síntese neural que roda NA MÁQUINA, sem navegador e sem cota.
 *
 * Este é o caminho principal da voz do Jarvis, e a razão é simples: as duas
 * alternativas anteriores tinham um dono que não é o Senhor Edson.
 *
 * - A síntese do Gemini custa de 2 a 7 segundos e tem teto de dez requisições
 *   por dia no plano gratuito — nada, para um assistente que fala o tempo todo.
 * - As vozes boas do navegador só existem no Edge, e ele não quer depender de
 *   um navegador específico. As que sua máquina tem instaladas são a "Maria
 *   Desktop" e a "Zira", ambas da geração mais antiga do Windows.
 *
 * O Piper resolve os dois: modelo ONNX local, ilimitado, offline, mesma voz em
 * qualquer navegador. Roda como processo filho e grava o WAV num arquivo.
 */

const RAIZ = resolve(process.cwd(), "vendor");
const PASTA_VOZES = join(RAIZ, "vozes");

/** Prazo generoso: a primeira chamada carrega o modelo de 60 MB para a memória. */
const TIMEOUT_MS = 30_000;
/** Um texto muito longo trava o processo por tempo demais. */
const MAX_CHARS = 1200;

/**
 * Prosódia.
 *
 * O modelo sozinho fala correto e sem intenção — é daí que vem a sensação de
 * robô. Estes três números são o que o Piper expõe para mexer nisso, e os
 * padrões dele são pensados para leitura neutra, não para alguém conversando ao
 * seu lado.
 *
 * - `length`: acima de 1 fala mais devagar. Um assistente sereno não atropela.
 * - `noise`: variação de entonação. Baixo demais soa monótono; alto demais
 *   desafina.
 * - `noiseW`: variação na duração de cada fonema — é o que quebra a cadência
 *   metronômica que denuncia síntese.
 * - `silencio`: respiro entre frases, em segundos.
 */
export type Prosodia = {
  length: number;
  noise: number;
  noiseW: number;
  silencio: number;
};

/** Escolhido de ouvido pelo Senhor Edson, comparando doze combinações. */
export const PROSODIA_PADRAO: Prosodia = {
  length: 1.05,
  noise: 0.85,
  noiseW: 1.0,
  silencio: 0.32,
};

/** Lê a prosódia do ambiente, para ajustar sem recompilar. */
function prosodiaConfigurada(): Prosodia {
  const numero = (chave: string, padrao: number) => {
    const bruto = Number(process.env[chave]);
    return Number.isFinite(bruto) ? bruto : padrao;
  };
  return {
    length: numero("VOZ_LENGTH", PROSODIA_PADRAO.length),
    noise: numero("VOZ_NOISE", PROSODIA_PADRAO.noise),
    noiseW: numero("VOZ_NOISE_W", PROSODIA_PADRAO.noiseW),
    silencio: numero("VOZ_SILENCIO", PROSODIA_PADRAO.silencio),
  };
}

export type VozLocal = {
  /** Identificador estável, usado na escolha e na chave do cache. */
  id: string;
  /** Nome curto para a interface. */
  nome: string;
  caminhoModelo: string;
};

function caminhoDoExecutavel(): string | null {
  const candidatos = [
    join(RAIZ, "piper", "piper.exe"),
    join(RAIZ, "piper", "piper", "piper.exe"),
    join(RAIZ, "piper", "piper"),
  ];
  return candidatos.find((caminho) => existsSync(caminho)) ?? null;
}

/** Vozes presentes na pasta. Nada é embutido no código: basta soltar o .onnx. */
export function vozesDisponiveis(): VozLocal[] {
  if (!existsSync(PASTA_VOZES)) return [];

  return readdirSync(PASTA_VOZES)
    .filter((arquivo) => arquivo.endsWith(".onnx"))
    .map((arquivo) => {
      const id = arquivo.replace(/\.onnx$/, "");
      // "pt_BR-faber-medium" -> "Faber"
      const nome = id.split("-")[1] ?? id;
      return {
        id,
        nome: nome.charAt(0).toUpperCase() + nome.slice(1),
        caminhoModelo: join(PASTA_VOZES, arquivo),
      };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export function vozLocalDisponivel(): boolean {
  return caminhoDoExecutavel() !== null && vozesDisponiveis().length > 0;
}

/**
 * A voz padrão do Jarvis.
 *
 * Escolhida de ouvido, e não por ordem alfabética — que foi como a Cadu acabou
 * virando padrão sem ninguém decidir. A ordem é: o que o `.env` mandar, depois
 * esta, depois qualquer uma instalada.
 */
const VOZ_PREFERIDA = "pt_BR-faber-medium";

export function vozLocalPadrao(): VozLocal | null {
  const vozes = vozesDisponiveis();
  if (vozes.length === 0) return null;

  const doAmbiente = process.env.VOZ_LOCAL?.trim();
  return (
    vozes.find((voz) => voz.id === doAmbiente) ??
    vozes.find((voz) => voz.id === VOZ_PREFERIDA) ??
    vozes[0]
  );
}

/** Assinatura da prosódia, para entrar na chave do cache. */
export function assinaturaDaProsodia(): string {
  const p = prosodiaConfigurada();
  return `${p.length}_${p.noise}_${p.noiseW}_${p.silencio}`;
}

/**
 * Confere que o WAV está íntegro.
 *
 * Existe por causa de um defeito real e silencioso: lendo o áudio pela saída
 * padrão, o Windows traduz cada byte 0x0A em 0x0D 0x0A — modo texto — e o áudio
 * chega com um byte a mais a cada quebra de linha encontrada por acaso na onda.
 * O arquivo tinha o tamanho certo, o processo saía com código zero, e o que se
 * ouvia era só estouro. Nada acusava.
 *
 * O cabeçalho declara quantos bytes de áudio existem; comparar com o que veio
 * de fato transforma esse tipo de corrupção em erro visível.
 */
export function conferirWav(wav: Buffer): { ok: true } | { ok: false; motivo: string } {
  if (wav.length < 44) return { ok: false, motivo: "áudio curto demais para ter cabeçalho" };
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    return { ok: false, motivo: "não é um arquivo WAV" };
  }

  const posData = wav.indexOf("data", 12, "ascii");
  if (posData < 0) return { ok: false, motivo: "sem bloco de dados" };

  const declarado = wav.readUInt32LE(posData + 4);
  const real = wav.length - (posData + 8);

  if (real !== declarado) {
    return {
      ok: false,
      motivo: `áudio corrompido: o cabeçalho declara ${declarado} bytes e chegaram ${real}`,
    };
  }
  return { ok: true };
}

/**
 * Sintetiza e devolve o WAV.
 *
 * O texto vai pela entrada padrão, e não como argumento: assim não há
 * escapamento a acertar, e um texto com aspas ou acento não vira comando
 * quebrado nem, pior, comando diferente do pretendido.
 *
 * O ÁUDIO, ao contrário, sai por ARQUIVO, e nunca pela saída padrão: no Windows
 * a saída padrão está em modo texto, e cada 0x0A do áudio virava 0x0D 0x0A. O
 * resultado tinha tamanho plausível, código de saída zero, e só estouro no
 * alto-falante.
 */
export function sintetizarLocal(
  texto: string,
  vozId?: string,
  prosodia?: Partial<Prosodia>
): Promise<Buffer> {
  return new Promise((resolver, rejeitar) => {
    const executavel = caminhoDoExecutavel();
    if (!executavel) return rejeitar(new Error("piper não está instalado em vendor/piper"));

    const vozes = vozesDisponiveis();
    const voz = (vozId ? vozes.find((v) => v.id === vozId) : null) ?? vozLocalPadrao();
    if (!voz) return rejeitar(new Error("nenhuma voz local instalada em vendor/vozes"));

    const limpo = String(texto ?? "").trim().slice(0, MAX_CHARS);
    if (!limpo) return rejeitar(new Error("não há texto para sintetizar"));

    const pastaTemp = mkdtempSync(join(tmpdir(), "jarvis-voz-"));
    const destino = join(pastaTemp, "fala.wav");

    const p = { ...prosodiaConfigurada(), ...prosodia };

    const filho = spawn(
      executavel,
      [
        "--model", voz.caminhoModelo,
        "--output_file", destino,
        "--length_scale", String(p.length),
        "--noise_scale", String(p.noise),
        "--noise_w", String(p.noiseW),
        "--sentence_silence", String(p.silencio),
      ],
      { windowsHide: true, cwd: join(RAIZ, "piper") }
    );

    const erros: string[] = [];
    let terminou = false;

    const limpar = () => {
      try {
        unlinkSync(destino);
      } catch {
        /* já sumiu */
      }
    };

    const prazo = setTimeout(() => {
      if (terminou) return;
      terminou = true;
      filho.kill();
      limpar();
      rejeitar(new Error(`a síntese local passou de ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);

    filho.stderr.on("data", (pedaco: Buffer) => erros.push(pedaco.toString()));

    filho.on("error", (erro) => {
      if (terminou) return;
      terminou = true;
      clearTimeout(prazo);
      rejeitar(erro);
    });

    filho.on("close", (codigo) => {
      if (terminou) return;
      terminou = true;
      clearTimeout(prazo);

      if (codigo !== 0) {
        limpar();
        return rejeitar(
          new Error(`piper falhou (código ${codigo}): ${erros.join(" ").slice(0, 200)}`)
        );
      }

      let wav: Buffer;
      try {
        wav = readFileSync(destino);
      } catch {
        limpar();
        return rejeitar(new Error("piper terminou sem gravar o áudio"));
      }
      limpar();

      // Código zero com saída vazia acontece quando o modelo não carrega: sem
      // esta checagem, o cliente receberia um WAV de zero byte e ficaria mudo
      // sem erro nenhum.
      const conferencia = conferirWav(wav);
      if (!conferencia.ok) return rejeitar(new Error(conferencia.motivo));

      resolver(wav);
    });

    filho.stdin.write(limpo);
    filho.stdin.end();
  });
}
