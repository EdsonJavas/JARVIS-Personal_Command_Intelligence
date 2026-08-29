/**
 * O contrato do fio entre o navegador e o servidor no modo de voz ao vivo.
 *
 * Regra que governa tudo: **quadro binário é PCM, quadro de texto é JSON**.
 * Do navegador sobe áudio de entrada em PCM 16 bits, 16 kHz, mono; do servidor
 * desce áudio de saída em PCM 16 bits, 24 kHz, mono. Qualquer outra coisa é
 * JSON.
 *
 * O áudio não passa por base64 neste trecho: são 25 quadros por segundo, e os
 * 33% de inchaço custariam banda e CPU sem ganho. A conversão para base64
 * acontece uma vez só, no servidor, porque a API do Google a exige.
 */

export const CAMINHO_VOZ_AO_VIVO = "/api/voz-ao-vivo";

export const TAXA_ENTRADA = 16_000;
export const TAXA_SAIDA = 24_000;
/** 40 ms por quadro: 25 mensagens por segundo, e a interrupção reage dentro de um. */
export const AMOSTRAS_POR_QUADRO = 640;

/** Do servidor para o navegador. */
export type DoServidor =
  | { t: "pronta"; modelo: string; execucaoId: string }
  | { t: "religando" }
  | { t: "transcricao"; de: "dono" | "jarvis"; texto: string; final: boolean }
  | { t: "falando"; ativo: boolean }
  | { t: "interrompido" }
  /** Enquanto uma confirmação está aberta, o microfone não sobe nada. */
  | { t: "microfone"; bloqueado: boolean; motivo?: string }
  | { t: "erro"; codigo: "quota" | "credencial" | "conexao" | "interno"; mensagem: string };

/** Do navegador para o servidor. */
export type DoNavegador =
  | { t: "texto"; conteudo: string }
  /** O dono soltou o microfone: fecha o turno de entrada. */
  | { t: "fim-da-fala" }
  | { t: "encerrar" };
