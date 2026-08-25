export function normalizeSpeech(value: string) {
  return value
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasWakeWord(transcript: string, wakeWord = "jarvis") {
  const normalized = normalizeSpeech(transcript);
  return new RegExp(`\\b${wakeWord}\\b`, "i").test(normalized);
}

export function requestAfterWakeWord(transcript: string, wakeWord = "jarvis") {
  return transcript.replace(new RegExp(`\\b${wakeWord}\\b[,.!?\\s]*`, "i"), "").trim();
}
