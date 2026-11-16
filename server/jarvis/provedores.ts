import { escadaDoGemini, modelosDisponiveis, type NivelDeModelo } from "./modelos";

/**
 * Quem responde, e quem responde quando o primeiro não pode.
 *
 * O Gemini gratuito acaba no meio do dia. O rodízio de modelos estica a cota,
 * mas quando a escada inteira do Gemini esgota, o Jarvis emudecia. Com uma
 * chave do Groq no `.env`, a pergunta passa para ele sozinha — e a ilha mostra
 * quem respondeu.
 *
 * A ordem é: o provedor do `LLM_BASE_URL` (se houver), o Gemini, o Groq.
 * Quem não tem chave fica de fora.
 */

export type IdDoProvedor = "gemini" | "groq" | "personalizado";

export type Provedor = {
  id: IdDoProvedor;
  /** O que a ilha mostra: "Gemini", "Groq" ou o endereço do personalizado. */
  nome: string;
  /** URL completa do /chat/completions. */
  endpoint: string;
  apiKey: string;
  /** A escada de modelos DESTE provedor, para o rodízio por cota. */
  modelos: (nivel: NivelDeModelo) => string[];
};

const URL_GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai/";
const URL_GROQ = "https://api.groq.com/openai/v1";

/**
 * A escada do Groq: todos chamam ferramenta, do mais capaz ao mais leve.
 * Cada modelo tem limite diário próprio no plano gratuito, como no Gemini.
 * Fonte: tabela de modelos com tool use em console.groq.com/docs/tool-use.
 */
const ESCADA_GROQ = [
  "openai/gpt-oss-120b",
  "llama-3.3-70b-versatile",
  "qwen/qwen3.8-27b",
  "openai/gpt-oss-20b",
];

export function endpointDeChat(baseUrl: string): string {
  const normalizada = baseUrl.trim().replace(/\/+$/, "");
  return normalizada.endsWith("/chat/completions") ? normalizada : `${normalizada}/chat/completions`;
}

const ehDoGoogle = (url: string) => /generativelanguage\.googleapis\.com/i.test(url);

function lista(texto: string | undefined): string[] {
  return (texto ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * A chave do Gemini, para o que SÓ o Gemini faz: voz ao vivo, voz sintetizada
 * e leitura da tela.
 *
 * `LLM_API_KEY` só vale aqui quando ela é do Google — a configuração antiga,
 * de antes de haver reserva. Mandar ao Google a chave do Groq não só falharia:
 * entregaria a credencial de um provedor a outro.
 */
export function chaveDoGemini(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const propria = env.GEMINI_API_KEY?.trim();
  if (propria) return propria;
  const base = env.LLM_BASE_URL?.trim();
  if (base && !ehDoGoogle(base)) return undefined;
  return env.LLM_API_KEY?.trim() || undefined;
}

export function provedoresConfigurados(env: NodeJS.ProcessEnv = process.env): Provedor[] {
  const provedores: Provedor[] = [];
  const base = env.LLM_BASE_URL?.trim();
  const chaveLlm = env.LLM_API_KEY?.trim() || env.GEMINI_API_KEY?.trim();

  if (base && chaveLlm && !ehDoGoogle(base)) {
    provedores.push({
      id: "personalizado",
      nome: nomeDoEndereco(base),
      endpoint: endpointDeChat(base),
      apiKey: chaveLlm,
      modelos: (nivel) => modelosDisponiveis(nivel, env),
    });
  }

  const chaveGemini = chaveDoGemini(env);
  if (chaveGemini) {
    // Principal, o Gemini respeita LLM_MODEL/LLM_MODELS como sempre. Reserva de
    // um personalizado, usa a escada própria: aqueles nomes são do outro.
    const principal = provedores.length === 0;
    provedores.push({
      id: "gemini",
      nome: "Gemini",
      endpoint: endpointDeChat(base && ehDoGoogle(base) ? base : URL_GEMINI),
      apiKey: chaveGemini,
      modelos: (nivel) => (principal ? modelosDisponiveis(nivel, env) : escadaDoGemini(nivel, env)),
    });
  }

  const chaveGroq = env.GROQ_API_KEY?.trim();
  if (chaveGroq) {
    const endpoint = endpointDeChat(URL_GROQ);
    // O personalizado já pode ser o próprio Groq: não entra duas vezes.
    if (!provedores.some((p) => p.endpoint === endpoint)) {
      const escolhidos = lista(env.GROQ_MODELS);
      provedores.push({
        id: "groq",
        nome: "Groq",
        endpoint,
        apiKey: chaveGroq,
        modelos: () => (escolhidos.length > 0 ? escolhidos : ESCADA_GROQ),
      });
    }
  }

  return provedores;
}

function nomeDoEndereco(url: string): string {
  try {
    return new URL(url).hostname.replace(/^api\./, "");
  } catch {
    return "personalizado";
  }
}
