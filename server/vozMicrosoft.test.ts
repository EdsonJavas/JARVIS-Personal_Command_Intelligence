import { afterEach, describe, expect, it } from "vitest";
import { assinaturaMicrosoft, vozMicrosoftLigada, vozMicrosoftPadrao } from "./vozMicrosoft";

/**
 * A voz neural da Microsoft, falada pelo servidor.
 *
 * Resolve o pedido que atravessou o projeto inteiro — voz fluida, com ênfase e
 * pronúncia correta — sem depender de navegador específico nem de cota. Mas ela
 * usa um endpoint que a Microsoft controla, então tudo aqui é sobre poder
 * desligá-la e cair para o Piper sem cerimônia.
 */

const original = { ...process.env };

afterEach(() => {
  process.env.VOZ_MICROSOFT = original.VOZ_MICROSOFT;
  process.env.VOZ_MICROSOFT_NOME = original.VOZ_MICROSOFT_NOME;
  process.env.VOZ_MICROSOFT_RITMO = original.VOZ_MICROSOFT_RITMO;
});

describe("desligar sem mexer em código", () => {
  it("está ligada por padrão", () => {
    delete process.env.VOZ_MICROSOFT;
    expect(vozMicrosoftLigada()).toBe(true);
  });

  it("VOZ_MICROSOFT=0 desliga", () => {
    // Se a Microsoft mudar o serviço e começar a devolver lixo, o dono não deve
    // precisar de mim para voltar ao Piper.
    process.env.VOZ_MICROSOFT = "0";
    expect(vozMicrosoftLigada()).toBe(false);
  });
});

describe("voz padrão", () => {
  it("é a Antonio, escolhida de ouvido", () => {
    delete process.env.VOZ_MICROSOFT_NOME;
    expect(vozMicrosoftPadrao()).toBe("pt-BR-AntonioNeural");
  });

  it("o ambiente sobrepõe", () => {
    process.env.VOZ_MICROSOFT_NOME = "pt-BR-FranciscaNeural";
    expect(vozMicrosoftPadrao()).toBe("pt-BR-FranciscaNeural");
  });
});

describe("assinatura para o cache", () => {
  it("muda quando a voz muda", () => {
    delete process.env.VOZ_MICROSOFT_NOME;
    const antes = assinaturaMicrosoft();
    process.env.VOZ_MICROSOFT_NOME = "pt-BR-FranciscaNeural";
    expect(assinaturaMicrosoft()).not.toBe(antes);
  });

  it("muda quando o ritmo muda", () => {
    // Sem isto, ajustar o ritmo não teria efeito nas frases já sintetizadas — e
    // são justamente os anúncios de ação, as mais faladas. O ajuste pareceria
    // simplesmente não funcionar.
    delete process.env.VOZ_MICROSOFT_NOME;
    const antes = assinaturaMicrosoft();
    process.env.VOZ_MICROSOFT_RITMO = "-20%";
    expect(assinaturaMicrosoft()).not.toBe(antes);
  });
});
