import { describe, expect, it } from "vitest";
import { entropia, inspecionarSegredo } from "./filtroDeSegredos";

describe("filtro de segredos", () => {
  it.each([
    ["sk-proj-abcdefghijklmnopqrstuvwxyz123456", "chave"],
    ["A chave é AIzaSyD-1234567890abcdefghijklmnopqrs", "chave"],
    ["AQ.EXEMPLO_FALSO_NAO_E_CHAVE_REAL_00000", "chave"],
    ["ghp_1234567890abcdefghijklmnopqrstuvwx", "chave"],
    ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.assinatura", "token"],
    ["-----BEGIN RSA PRIVATE KEY-----", "chave"],
    ["senha: minhasenhasecreta123", "credencial"],
    ["API_KEY=xyz987654321", "credencial"],
  ])("bloqueia %s", (conteudo, categoria) => {
    const veredito = inspecionarSegredo(conteudo);
    expect(veredito.permitido).toBe(false);
    if (!veredito.permitido) expect(veredito.categoria).toBe(categoria);
  });

  it("bloqueia número de cartão que passa no Luhn", () => {
    // 4539578763621486 é um número de teste válido pelo algoritmo.
    const veredito = inspecionarSegredo("cartão 4539578763621486");
    expect(veredito.permitido).toBe(false);
  });

  it("não bloqueia dezesseis dígitos que não são cartão", () => {
    // Sem a validação de Luhn, qualquer sequência longa de dígitos — um número
    // de nota fiscal, por exemplo — seria barrada.
    expect(inspecionarSegredo("protocolo 1111111111111112").permitido).toBe(true);
  });

  it("bloqueia CPF válido e ignora sequência inválida", () => {
    expect(inspecionarSegredo("meu CPF é 529.982.247-25").permitido).toBe(false);
    expect(inspecionarSegredo("o código é 111.111.111-11").permitido).toBe(true);
  });

  it("bloqueia conteúdo longo demais", () => {
    const veredito = inspecionarSegredo("x".repeat(500));
    expect(veredito.permitido).toBe(false);
    if (!veredito.permitido) expect(veredito.categoria).toBe("tamanho");
  });

  it("NÃO bloqueia anotar onde um arquivo mora", () => {
    // Registrar a localização é legítimo; o que não pode é o conteúdo.
    expect(
      inspecionarSegredo("o .env do jarvis fica em C:\\Users\\es553\\jarvis-web\\.env").permitido
    ).toBe(true);
  });

  it("deixa passar fatos comuns sobre o dono", () => {
    expect(inspecionarSegredo("Edson prefere café forte pela manhã").permitido).toBe(true);
    expect(inspecionarSegredo("O projeto principal é o imobx").permitido).toBe(true);
    expect(inspecionarSegredo("Trabalha em Marília, São Paulo").permitido).toBe(true);
  });

  it("bloqueia sequência longa de alta entropia", () => {
    const veredito = inspecionarSegredo("guarde isso: xK9mQ2vB7nL4pR8sT1wY6zA3cF5gH0jD");
    expect(veredito.permitido).toBe(false);
  });

  it("entropia distingue frase de credencial", () => {
    expect(entropia("uma frase comum em portugues")).toBeLessThan(4.2);
    expect(entropia("xK9mQ2vB7nL4pR8sT1wY6zA3cF5gH0jD")).toBeGreaterThan(3.4);
  });
});

describe("formatos que escapavam", () => {
  it("senha embutida em endereço de conexão não passa", () => {
    // A regra de entropia ignora qualquer coisa com cara de URL — legítimo para
    // caminhos, mas deixava a senha inteira passar dentro do endereço.
    for (const texto of [
      "o banco é postgres://admin:S3nh4Secreta@db.interno:5432/imobx",
      "mysql://root:root123@localhost/loja",
      "redis://:umaSenhaAqui@127.0.0.1:6379",
    ]) {
      expect(inspecionarSegredo(texto).permitido, texto).toBe(false);
    }
  });

  it("endereço SEM credencial continua permitido", () => {
    // Anotar onde um serviço mora é legítimo e útil.
    expect(inspecionarSegredo("o banco fica em postgres://db.interno:5432/imobx").permitido).toBe(
      true
    );
  });

  it("rótulo em UPPER_SNAKE não escapa", () => {
    // `` não separa dentro de `DB_PASSWORD`, e esse é justamente o formato que
    // ele mais vê ao ler saída de PowerShell e arquivo de ambiente.
    for (const texto of [
      "DB_PASSWORD=abacaxi123",
      "GEMINI_API_KEY=algumacoisa",
      "ACCESS_KEY: valorqualquer",
    ]) {
      expect(inspecionarSegredo(texto).permitido, texto).toBe(false);
    }
  });

  it("Luhn é conferido no trecho casado, não nos dígitos do texto todo", () => {
    // Um ano escrito antes deslocava a sequência e o cartão passava.
    const cartaoValido = "4539 1488 0343 6467";
    expect(inspecionarSegredo(cartaoValido).permitido).toBe(false);
    expect(inspecionarSegredo(`em 2024 usei o cartao ${cartaoValido}`).permitido).toBe(false);
  });

  it("sequência de dezesseis dígitos que não é cartão continua passando", () => {
    expect(inspecionarSegredo("o protocolo é 1234 5678 9012 3456").permitido).toBe(true);
  });
});

