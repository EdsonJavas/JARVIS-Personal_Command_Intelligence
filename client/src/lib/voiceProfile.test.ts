import { describe, expect, it } from "vitest";
import {
  avisoDeVozAntiga,
  escolherVozBrasileira,
  getBrazilianVoiceFallback,
  selectBrazilianMaleVoice,
} from "./voiceProfile";

const voz = (name: string, lang = "pt-BR") => ({ name, lang });

/** O que um Windows 11 com Edge realmente devolve em getVoices(). */
const WINDOWS_COM_EDGE = [
  voz("Microsoft Maria - Portuguese (Brazil)"),
  voz("Microsoft Daniel - Portuguese (Brazil)"),
  voz("Microsoft Antonio Online (Natural) - Portuguese (Brazil)"),
  voz("Microsoft Thalita Online (Natural) - Portuguese (Brazil)"),
  voz("Microsoft David - English (United States)", "en-US"),
];

describe("escolher voz brasileira", () => {
  it("prefere a NEURAL à masculina antiga", () => {
    // Este é o defeito que fazia o Jarvis soar robótico: a escolha pegava a
    // primeira voz masculina, que é a SAPI antiga, e ignorava a neural ao lado.
    const escolhida = escolherVozBrasileira(WINDOWS_COM_EDGE);
    expect(escolhida?.voz.name).toContain("Antonio Online (Natural)");
    expect(escolhida?.natural).toBe(true);
  });

  it("entre duas neurais, fica com a masculina", () => {
    const escolhida = escolherVozBrasileira([
      voz("Microsoft Thalita Online (Natural) - Portuguese (Brazil)"),
      voz("Microsoft Antonio Online (Natural) - Portuguese (Brazil)"),
    ]);
    expect(escolhida?.voz.name).toContain("Antonio");
  });

  it("voz neural feminina ganha de masculina antiga", () => {
    // Preferir masculina é forte, não absoluto: uma neural feminina soa melhor
    // que uma SAPI masculina, e o timbre é o que incomoda.
    const escolhida = escolherVozBrasileira([
      voz("Microsoft Daniel - Portuguese (Brazil)"),
      voz("Microsoft Thalita Online (Natural) - Portuguese (Brazil)"),
    ]);
    expect(escolhida?.voz.name).toContain("Natural");
  });

  it("sem neural, cai na masculina disponível", () => {
    const escolhida = escolherVozBrasileira([
      voz("Microsoft Maria - Portuguese (Brazil)"),
      voz("Microsoft Daniel - Portuguese (Brazil)"),
    ]);
    expect(escolhida?.voz.name).toContain("Daniel");
    expect(escolhida?.natural).toBe(false);
  });

  it("só a Maria instalada ainda fala, em vez de silêncio", () => {
    // Exigir voz masculina resultava em silêncio absoluto num Windows que só
    // traz a Maria.
    const escolhida = escolherVozBrasileira([voz("Microsoft Maria - Portuguese (Brazil)")]);
    expect(escolhida?.voz.name).toContain("Maria");
  });

  it("a Google do Chrome conta como natural", () => {
    const escolhida = escolherVozBrasileira([
      voz("Microsoft Daniel - Portuguese (Brazil)"),
      voz("Google português do Brasil"),
    ]);
    expect(escolhida?.voz.name).toContain("Google");
    expect(escolhida?.natural).toBe(true);
  });

  it("sem voz brasileira, não escolhe nada", () => {
    expect(escolherVozBrasileira([voz("Microsoft David", "en-US")])).toBeUndefined();
  });
});

describe("aviso de voz antiga", () => {
  it("avisa quando só há voz antiga, e diz o caminho da solução", () => {
    const escolhida = escolherVozBrasileira([voz("Microsoft Daniel - Portuguese (Brazil)")]);
    const aviso = avisoDeVozAntiga(escolhida);
    expect(aviso).toContain("Edge");
  });

  it("cala a boca quando a voz já é neural", () => {
    const escolhida = escolherVozBrasileira(WINDOWS_COM_EDGE);
    expect(avisoDeVozAntiga(escolhida)).toBeNull();
  });
});

describe("compatibilidade", () => {
  it("selectBrazilianMaleVoice continua achando voz masculina", () => {
    expect(selectBrazilianMaleVoice(WINDOWS_COM_EDGE)?.name).toContain("Daniel");
  });

  it("getBrazilianVoiceFallback explica o que instalar", () => {
    expect(getBrazilianVoiceFallback([voz("Microsoft Maria - Portuguese (Brazil)")])).toContain(
      "masculina brasileira"
    );
    expect(getBrazilianVoiceFallback([voz("Google US English", "en-US")])).toContain(
      "Nenhuma voz brasileira"
    );
  });
});
