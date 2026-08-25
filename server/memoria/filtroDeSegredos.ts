/**
 * Barreira entre o que o Jarvis vê e o que ele grava para sempre.
 *
 * Ele lê arquivos, roda comandos e enxerga a saída. Uma chave de API que passe
 * por uma leitura de `.env` não pode virar linha permanente no banco. Aqui a
 * regra é o inverso da usual: na dúvida, BLOQUEIA. Perder uma memória legítima
 * custa o dono repetir a informação; gravar um segredo é irreversível na
 * prática.
 */

export type Veredito =
  | { permitido: true }
  | { permitido: false; categoria: string; motivo: string };

/** Acima disso, quase certamente é saída de comando colada, não um fato. */
const MAX_CARACTERES = 400;

/**
 * `escopo` diz COMO redigir, não se bloqueia.
 *
 * - "rotulo": preserva o nome e apaga o valor (`DB_PASSWORD=…`).
 * - "uri": apaga só usuário e senha, preservando protocolo e host — perder o
 *   endereço do banco junto com a senha tornaria a leitura inútil.
 */
type Regra = {
  re: RegExp;
  categoria: string;
  motivo: string;
  escopo?: "rotulo" | "uri";
};

const REGRAS: Regra[] = [
  { re: /\bsk-[A-Za-z0-9_-]{16,}/, categoria: "chave", motivo: "parece uma chave de API" },
  { re: /\bAIza[0-9A-Za-z_-]{20,}/, categoria: "chave", motivo: "parece uma chave do Google" },
  { re: /\bAQ\.[A-Za-z0-9_-]{20,}/, categoria: "chave", motivo: "parece uma chave do Google AI Studio" },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}/, categoria: "chave", motivo: "parece um token do GitHub" },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/, categoria: "chave", motivo: "parece um token do Slack" },
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, categoria: "token", motivo: "parece um JWT" },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, categoria: "chave", motivo: "é uma chave privada" },
  {
    /*
     * A fronteira aceita `_` e `-` porque `\b` não separa dentro de
     * UPPER_SNAKE: `DB_PASSWORD=` não casava com `\bpassword\b`, e esse é
     * justamente o formato que o Jarvis mais vê ao ler saída de PowerShell e
     * arquivos de ambiente.
     */
    re: /(^|[\s_\-.[{,"'])(senha|password|passwd|pwd|secret|token|api[_-]?key|credential|auth|bearer|access[_-]?key)([\s_\-]*)\s*[:=]\s*\S+/i,
    categoria: "credencial",
    motivo: "traz uma credencial atribuída a um rótulo",
    escopo: "rotulo",
  },
  {
    // Credencial embutida em URI: postgres://usuario:senha@host. Cai antes da
    // regra de entropia, que ignora qualquer coisa com cara de URL e por isso
    // deixava a senha passar inteira.
    // Usuário pode vir vazio (`redis://:senha@host`), a senha não.
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]*:[^\s/@]+@/i,
    categoria: "credencial",
    motivo: "traz usuário e senha embutidos num endereço de conexão",
    escopo: "uri",
  },
  {
    re: /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/,
    categoria: "cartao",
    motivo: "parece um número de cartão",
  },
];

/** Luhn: separa número de cartão de qualquer sequência de dezesseis dígitos. */
function passaNoLuhn(digitos: string): boolean {
  let soma = 0;
  let alternar = false;
  for (let i = digitos.length - 1; i >= 0; i -= 1) {
    let valor = Number(digitos[i]);
    if (alternar) {
      valor *= 2;
      if (valor > 9) valor -= 9;
    }
    soma += valor;
    alternar = !alternar;
  }
  return soma % 10 === 0;
}

/** Validação real de CPF: sem isto, qualquer sequência de onze dígitos bloquearia. */
function ehCpfValido(digitos: string): boolean {
  if (digitos.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digitos)) return false;

  const calcular = (ate: number) => {
    let soma = 0;
    for (let i = 0; i < ate; i += 1) soma += Number(digitos[i]) * (ate + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return calcular(9) === Number(digitos[9]) && calcular(10) === Number(digitos[10]);
}

/**
 * Entropia de Shannon por caractere.
 *
 * Segredo gerado por máquina tem entropia alta; frase em português, baixa. Só
 * se aplica a trechos longos e sem espaço, para não confundir texto normal com
 * credencial.
 */
export function entropia(texto: string): number {
  if (!texto) return 0;
  const frequencia = new Map<string, number>();
  for (const caractere of texto) {
    frequencia.set(caractere, (frequencia.get(caractere) ?? 0) + 1);
  }
  let resultado = 0;
  for (const contagem of frequencia.values()) {
    const p = contagem / texto.length;
    resultado -= p * Math.log2(p);
  }
  return resultado;
}

export function inspecionarSegredo(
  conteudo: string,
  opcoes: { limitarTamanho?: boolean } = {}
): Veredito {
  const texto = String(conteudo ?? "");

  /*
   * O teto de tamanho é regra da MEMÓRIA, não do segredo.
   *
   * Faz sentido ali — memória é fato curto, não despejo de comando. Aplicado à
   * área de transferência, recusava qualquer texto longo dizendo que era
   * segredo, o que é falso e confunde: copiar um artigo não é copiar uma senha.
   */
  if ((opcoes.limitarTamanho ?? true) && texto.length > MAX_CARACTERES) {
    // A defesa mais efetiva contra vazamento acidental: memória é fato curto,
    // não despejo de saída de comando.
    return {
      permitido: false,
      categoria: "tamanho",
      motivo: `tem ${texto.length} caracteres; memória é fato curto, não saída de comando`,
    };
  }

  for (const regra of REGRAS) {
    if (!regra.re.test(texto)) continue;

    if (regra.categoria === "cartao") {
      /*
       * Luhn sobre o TRECHO casado, não sobre os dígitos do texto inteiro.
       * Juntando tudo, um "2024" escrito antes do número deslocava a sequência
       * e o cartão passava — e, ao contrário, uma data qualquer podia reprovar
       * um número legítimo.
       */
      const candidatos = texto.match(new RegExp(regra.re.source, "gi")) ?? [];
      const algumEhCartao = candidatos.some((trecho) =>
        passaNoLuhn((trecho.match(/\d/g) ?? []).join(""))
      );
      if (!algumEhCartao) continue;
    }

    return { permitido: false, categoria: regra.categoria, motivo: regra.motivo };
  }

  const cpf = /\b(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})\b/.exec(texto);
  if (cpf && ehCpfValido(cpf.slice(1).join(""))) {
    return { permitido: false, categoria: "cpf", motivo: "traz um CPF" };
  }

  // Sequência longa sem espaço e com entropia alta: cara de credencial.
  //
  // Caminhos e endereços ficam de fora: eles são longos e sem espaço por
  // natureza, e a entropia os acusaria. Anotar ONDE um arquivo mora é
  // legítimo — o que não pode virar memória é o conteúdo dele.
  const pareceCaminhoOuUrl = (parte: string) =>
    /[\\/]/.test(parte) || /^https?:/i.test(parte) || /^[A-Za-z]:$/.test(parte);

  const candidatos = texto
    .split(/\s+/)
    .filter((parte) => parte.length >= 24 && !pareceCaminhoOuUrl(parte));

  for (const candidato of candidatos) {
    if (entropia(candidato) > 3.4 && /[A-Za-z]/.test(candidato) && /\d/.test(candidato)) {
      return {
        permitido: false,
        categoria: "entropia",
        motivo: "contém uma sequência longa e aleatória, típica de credencial",
      };
    }
  }

  return { permitido: true };
}

/** O que substitui um segredo encontrado. Visível, para o modelo saber que havia algo. */
const MARCA = "«segredo removido»";

export type Redacao = { texto: string; removidos: number };

/**
 * Apaga segredos do texto em vez de recusá-lo.
 *
 * Para MEMÓRIA a recusa é certa: o que não deve existir não chega a ser gravado.
 * Para LEITURA de arquivo, recusar seria inútil — o dono precisa que o Jarvis
 * leia o `.env` para conferir se uma variável existe, e ele não deveria ter que
 * escolher entre isso e mandar a chave para o provedor.
 *
 * A marca fica visível de propósito: o modelo precisa saber que havia algo ali,
 * senão explicaria a ausência como se a linha não existisse.
 */
export function redigirSegredos(conteudo: string): Redacao {
  let texto = String(conteudo ?? "");
  let removidos = 0;

  const trocar = (re: RegExp, comoTrocar?: (casado: string) => string) => {
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    texto = texto.replace(global, (casado) => {
      // Trecho que JÁ foi redigido não é redigido de novo. Sem esta guarda, a
      // regra do rótulo casava o resultado da regra da chave e o texto virava
      // "LLM_API_KEY=«segredo removido» removido»".
      if (casado.includes(MARCA)) return casado;
      removidos += 1;
      return comoTrocar ? comoTrocar(casado) : MARCA;
    });
  };

  /*
   * A ordem importa: a regra do RÓTULO vem primeiro.
   *
   * Ela preserva o nome e apaga só o valor — "DB_PASSWORD=«segredo removido»"
   * diz ao modelo que a variável existe, que é a pergunta usual. Rodando depois
   * das outras, ela encontraria o valor já substituído e redigiria em cima.
   */
  for (const regra of REGRAS) {
    if (regra.escopo === "rotulo") {
      trocar(regra.re, (casado) => casado.replace(/([:=]\s*)\S+$/, `$1${MARCA}`));
    } else if (regra.escopo === "uri") {
      // Só o "usuario:senha@" sai; "postgres://" e o host ficam.
      trocar(regra.re, (casado) => casado.replace(/\/\/[^@]*@/, `//${MARCA}@`));
    }
  }

  for (const regra of REGRAS) {
    if (regra.categoria === "cartao" || regra.escopo) continue;
    trocar(regra.re);
  }

  // Cartão só sai se passar no Luhn: uma sequência qualquer de dezesseis dígitos
  // costuma ser protocolo ou código de barras, não cartão.
  texto = texto.replace(/\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, (casado) => {
    if (!passaNoLuhn((casado.match(/\d/g) ?? []).join(""))) return casado;
    removidos += 1;
    return MARCA;
  });

  texto = texto.replace(/\b(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})\b/g, (casado, ...partes) => {
    if (!ehCpfValido(partes.slice(0, 4).join(""))) return casado;
    removidos += 1;
    return MARCA;
  });

  return { texto, removidos };
}
