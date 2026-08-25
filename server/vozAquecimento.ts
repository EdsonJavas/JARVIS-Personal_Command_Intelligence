import { frasesFixasDeAnuncio } from "./tools/registry";
import { synthesizeSpeech } from "./jarvisTts";
import { estaEmCache } from "./vozCache";
import { podeSintetizar, saldo } from "./vozOrcamento";
import { vozLocalDisponivel } from "./vozLocal";

/**
 * Sintetiza de véspera as frases com que o Jarvis anuncia cada ação.
 *
 * A ordem que o dono quer é pensar, falar, executar — falando ENQUANTO executa.
 * Isso não se consegue enquanto a síntese custa de 2 a 7 segundos e a ferramenta
 * termina em um: a fala chega sempre depois. Com as frases fixas já prontas em
 * cache, o anúncio sai instantâneo e a voz volta a vir na frente.
 *
 * Roda em segundo plano, uma por vez, e nunca derruba o servidor: é conforto, e
 * o caminho normal de síntese continua valendo se isto falhar.
 */

/** Espaço entre sínteses, para o aquecimento não competir com um pedido real. */
const INTERVALO_MS = 1500;

/**
 * Quantas frases novas aquecer por dia.
 *
 * São doze frases fixas e apenas dez requisições diárias. Aquecer todas de uma
 * vez torrava a cota inteira no arranque e deixava o dono sem voz neural para a
 * conversa — o oposto do objetivo. Duas por dia enchem o cache em menos de uma
 * semana, e como o cache é permanente, cada frase se paga uma única vez na vida.
 */
const NOVAS_POR_DIA = 2;

let jaRodou = false;

export function aquecerVoz(): void {
  if (jaRodou) return;
  jaRodou = true;

  void (async () => {
    const frases = frasesFixasDeAnuncio();
    const localDisponivel = vozLocalDisponivel();
    let jaEmCache = 0;
    let sintetizadas = 0;

    for (const frase of frases) {
      // Cai no cache em disco se já foi sintetizada antes: instantâneo e sem
      // custo de cota. É o caso da maioria, depois dos primeiros dias.
      if (await estaEmCache(frase)) {
        jaEmCache += 1;
        continue;
      }

      /*
       * O racionamento só existe por causa da cota do provedor remoto. Com a
       * voz local instalada não há cota nenhuma, e aquecer tudo de uma vez é o
       * certo: o dono ouve o anúncio instantâneo já na primeira tarefa.
       */
      if (!localDisponivel) {
        if (sintetizadas >= NOVAS_POR_DIA) continue;
        if (!podeSintetizar("anuncio")) break;
      }

      try {
        await synthesizeSpeech(frase, { prioridade: "anuncio" });
        sintetizadas += 1;
      } catch {
        // Sem chave, sem rede ou cota estourada: o aquecimento simplesmente não
        // acontece. Não é motivo para barulho a cada reinício.
        break;
      }
      // Só espera entre chamadas quando elas vão para a rede.
      if (!localDisponivel) {
        await new Promise((resolver) => setTimeout(resolver, INTERVALO_MS));
      }
    }

    const prontas = jaEmCache + sintetizadas;
    const { gastas, limite } = saldo();
    console.log(
      `[Voz] ${prontas}/${frases.length} anúncios em cache` +
        (sintetizadas ? ` (${sintetizadas} novos)` : "") +
        (localDisponivel ? " · voz local, sem cota" : ` · cota neural do dia: ${gastas}/${limite}`)
    );
  })();
}
