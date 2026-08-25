import { describe, expect, it } from "vitest";
import { conferirWav } from "./vozLocal";

/**
 * A conferência de integridade do áudio.
 *
 * Existe por causa de um defeito que passou por tudo sem acusar: lendo o áudio
 * pela saída padrão no Windows, cada byte 0x0A da onda virava 0x0D 0x0A. O
 * arquivo tinha tamanho plausível, o processo saía com código zero, os testes
 * passavam — e o que se ouvia era só estouro.
 */

/** Monta um WAV, opcionalmente com o cabeçalho mentindo sobre o tamanho. */
function wav(amostras: number, bytesDeclaradosAMais = 0): Buffer {
  const dados = Buffer.alloc(amostras * 2);
  const cabecalho = Buffer.alloc(44);
  cabecalho.write("RIFF", 0);
  cabecalho.writeUInt32LE(36 + dados.length, 4);
  cabecalho.write("WAVE", 8);
  cabecalho.write("fmt ", 12);
  cabecalho.writeUInt32LE(16, 16);
  cabecalho.writeUInt16LE(1, 20);
  cabecalho.writeUInt16LE(1, 22);
  cabecalho.writeUInt32LE(22050, 24);
  cabecalho.writeUInt32LE(44100, 28);
  cabecalho.writeUInt16LE(2, 32);
  cabecalho.writeUInt16LE(16, 34);
  cabecalho.write("data", 36);
  cabecalho.writeUInt32LE(dados.length - bytesDeclaradosAMais, 40);
  return Buffer.concat([cabecalho, dados]);
}

describe("conferir WAV", () => {
  it("aceita áudio íntegro", () => {
    expect(conferirWav(wav(1000)).ok).toBe(true);
  });

  it("RECUSA áudio com bytes a mais do que o cabeçalho declara", () => {
    // É a assinatura exata da tradução de modo texto do Windows: um byte extra
    // para cada 0x0A que a onda contiver por acaso.
    const resultado = conferirWav(wav(1000, 17));
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.motivo).toContain("corrompido");
  });

  it("recusa arquivo vazio ou curto demais", () => {
    expect(conferirWav(Buffer.alloc(0)).ok).toBe(false);
    expect(conferirWav(Buffer.alloc(20)).ok).toBe(false);
  });

  it("recusa o que não é WAV", () => {
    // Piper pode terminar com código zero e gravar uma mensagem de erro.
    const resultado = conferirWav(Buffer.from("erro ao carregar o modelo onnx aaaaaaaaaaaaaaaaaa"));
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.motivo).toContain("não é um arquivo WAV");
  });
});

describe("voz padrão", () => {
  it("a preferência do ambiente vence a do código", async () => {
    // Trocar a voz sem recompilar precisa funcionar: é como o dono afina.
    const anterior = process.env.VOZ_LOCAL;
    process.env.VOZ_LOCAL = "pt_BR-jeff-medium";
    const { vozLocalPadrao, vozesDisponiveis } = await import("./vozLocal");

    if (vozesDisponiveis().some((v) => v.id === "pt_BR-jeff-medium")) {
      expect(vozLocalPadrao()?.id).toBe("pt_BR-jeff-medium");
    }
    process.env.VOZ_LOCAL = anterior;
  });

  it("sem ambiente, usa a escolhida de ouvido — não a primeira do alfabeto", async () => {
    // A Cadu virou padrão sem ninguém decidir, só por vir antes em ordem
    // alfabética. O dono comparou doze combinações e apontou a Faber.
    const anterior = process.env.VOZ_LOCAL;
    delete process.env.VOZ_LOCAL;
    const { vozLocalPadrao, vozesDisponiveis } = await import("./vozLocal");

    if (vozesDisponiveis().some((v) => v.id === "pt_BR-faber-medium")) {
      expect(vozLocalPadrao()?.id).toBe("pt_BR-faber-medium");
    }
    if (anterior !== undefined) process.env.VOZ_LOCAL = anterior;
  });
});
