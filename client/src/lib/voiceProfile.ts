export type VoiceProfileOption = Pick<SpeechSynthesisVoice, "lang" | "name">;

/**
 * Escolha da voz local do navegador.
 *
 * Importa mais do que parece. A síntese neural do Gemini tem teto de dez
 * requisições por DIA no plano gratuito, então na prática a voz local é a que o
 * Senhor Edson mais ouve — e escolher mal é a diferença entre soar como o Jarvis
 * e soar como um leitor de tela dos anos noventa.
 *
 * O ponto que a versão anterior perdia: navegadores baseados em Chromium
 * expõem, além das vozes SAPI antigas do Windows, as vozes NEURAIS da Microsoft,
 * com "Natural" ou "Online" no nome. São incomparavelmente melhores, gratuitas e
 * sem limite de uso. Pegar a primeira voz masculina que aparecesse quase sempre
 * entregava a SAPI antiga, que é a robótica.
 */

const NOME_MASCULINO =
  /\b(male|mascul|homem|daniel|david|jorge|felipe|ricardo|antonio|antônio|carlos|lucas|miguel|bruno|eduardo|fabio|fábio|marcos|paulo|julio|júlio|valerio|valério|donato|humberto|nicolau)\b/i;

/** Marca das vozes neurais da Microsoft no Edge e no Chrome. */
const NEURAL = /\b(natural|online)\b/i;

/** Vozes SAPI antigas do Windows: as que soam robóticas. */
const SAPI_ANTIGA = /\b(microsoft (maria|daniel|helo[ií]sa)\b(?!.*\b(natural|online)\b))/i;

export type VozEscolhida<T> = {
  voz: T;
  /** Neural: dispensa correção de tom, e já soa natural sozinha. */
  natural: boolean;
};

function pontuar(voz: VoiceProfileOption): number {
  let pontos = 0;

  // Uma voz neural mal entoada ainda ganha de uma SAPI bem escolhida: o peso é
  // deliberadamente maior que a soma de todos os outros critérios.
  if (NEURAL.test(voz.name)) pontos += 100;
  // A "Google português do Brasil" do Chrome é remota e bem acima da SAPI.
  if (/^google/i.test(voz.name)) pontos += 40;

  if (NOME_MASCULINO.test(voz.name)) pontos += 20;
  if (SAPI_ANTIGA.test(voz.name)) pontos -= 15;

  return pontos;
}

/**
 * Melhor voz brasileira disponível, com preferência por masculina.
 *
 * A preferência por masculina é forte, mas não absoluta: um Windows 11 em
 * português costuma trazer só a "Maria", e exigir voz masculina resultava em
 * silêncio absoluto. Uma voz neural feminina soa melhor do que nenhuma voz.
 */
export function escolherVozBrasileira<T extends VoiceProfileOption>(
  voices: T[]
): VozEscolhida<T> | undefined {
  const brasileiras = voices.filter((voz) => voz.lang.toLowerCase().startsWith("pt-br"));
  if (brasileiras.length === 0) return undefined;

  const melhor = [...brasileiras].sort((a, b) => pontuar(b) - pontuar(a))[0];
  return { voz: melhor, natural: NEURAL.test(melhor.name) || /^google/i.test(melhor.name) };
}

/** Mantida para quem só precisa da voz masculina, sem a decisão de qualidade. */
export function selectBrazilianMaleVoice<T extends VoiceProfileOption>(
  voices: T[]
): T | undefined {
  return voices.find(
    (voice) => voice.lang.toLowerCase().startsWith("pt-br") && NOME_MASCULINO.test(voice.name)
  );
}

export function getBrazilianVoiceFallback(voices: VoiceProfileOption[]): string | undefined {
  const temBrasileira = voices.some((voice) => voice.lang.toLowerCase().startsWith("pt-br"));
  if (temBrasileira) {
    return "Nenhuma voz masculina brasileira encontrada. Instale uma voz masculina em português do Brasil nas configurações do dispositivo.";
  }
  return "Nenhuma voz brasileira encontrada. Instale uma voz em português do Brasil nas configurações do dispositivo.";
}

/**
 * Aviso quando só há voz antiga instalada.
 *
 * Vale a pena dizer: instalar uma voz neural é uma troca grande de qualidade por
 * cinco minutos de configuração, e sem o aviso ele não teria como saber que
 * existe opção melhor.
 */
export function avisoDeVozAntiga(escolhida: VozEscolhida<VoiceProfileOption> | undefined): string | null {
  if (!escolhida || escolhida.natural) return null;
  return (
    "A voz em uso é uma das antigas do Windows, por isso o timbre metálico. " +
    "Abrindo o Jarvis no Microsoft Edge, ou instalando uma voz “Natural” em " +
    "Configurações › Hora e idioma › Fala, ele passa a usar uma voz neural."
  );
}
