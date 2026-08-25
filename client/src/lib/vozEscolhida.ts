import type { VoiceProfileOption } from "./voiceProfile";

/**
 * A voz que o Senhor Edson escolheu de ouvido.
 *
 * Existe porque a escolha automática errou três vezes seguidas. Nenhuma
 * heurística sabe qual timbre soa bem para quem escuta: a máquina dele só tinha
 * a "Maria Desktop", uma voz feminina da geração mais antiga do Windows, e o
 * seletor a elegia por ser a única em português. Ouvir e apontar acaba com isso.
 *
 * Guardado no navegador, e não no servidor, de propósito: as vozes disponíveis
 * são do navegador, então a escolha só faz sentido onde ela é possível. Abrir no
 * Edge e no Chrome pode render escolhas diferentes, e está certo assim.
 */

const CHAVE = "jarvis.voz.escolhida";

export function lerVozEscolhida(): string | null {
  try {
    return localStorage.getItem(CHAVE);
  } catch {
    // Navegador com armazenamento bloqueado: cai na escolha automática.
    return null;
  }
}

export function guardarVozEscolhida(nome: string | null): void {
  try {
    if (nome) localStorage.setItem(CHAVE, nome);
    else localStorage.removeItem(CHAVE);
  } catch {
    /* sem armazenamento: a escolha vale só para esta sessão */
  }
}

/** Frase de teste: longa o bastante para o timbre metálico aparecer. */
export const FRASE_DE_TESTE =
  "Boa noite, Senhor. O disco C está com oitenta e dois por cento ocupado, e encontrei quatro instaladores antigos somando dois gigabytes. Posso removê-los?";

/**
 * Qualidade aparente de uma voz, para agrupar a lista.
 *
 * "Natural" e "Online" marcam as vozes neurais da Microsoft, que o Edge expõe;
 * "Google" é a voz remota do Chrome. As demais são a síntese antiga do Windows —
 * as que soam metálicas.
 */
export type Qualidade = "neural" | "antiga";

export function qualidadeDaVoz(voz: VoiceProfileOption): Qualidade {
  if (/\b(natural|online)\b/i.test(voz.name)) return "neural";
  if (/^google/i.test(voz.name)) return "neural";
  return "antiga";
}

/** Só o nome próprio, sem o prefixo do fabricante nem o idioma no fim. */
export function nomeCurto(voz: VoiceProfileOption): string {
  return voz.name
    .replace(/^Microsoft\s+/i, "")
    .replace(/\s*-\s*(Portuguese|Português).*$/i, "")
    .replace(/\s*\(Brazil\)\s*$/i, "")
    .trim();
}

/**
 * Vozes em português, as neurais primeiro.
 *
 * Sem separar por qualidade, a lista sai na ordem que o navegador entrega — e a
 * voz antiga aparece antes da boa, que é justamente o engano a evitar.
 */
export function vozesParaEscolher<T extends VoiceProfileOption>(vozes: T[]): T[] {
  return vozes
    .filter((voz) => voz.lang.toLowerCase().startsWith("pt"))
    .sort((a, b) => {
      const qualidade = Number(qualidadeDaVoz(b) === "neural") - Number(qualidadeDaVoz(a) === "neural");
      if (qualidade !== 0) return qualidade;
      return a.name.localeCompare(b.name, "pt-BR");
    });
}
