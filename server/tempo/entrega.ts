import { anunciarIniciativa } from "../jarvisStream";
import { aoDisparar, iniciarAgendador, type Iniciativa } from "./agendador";
import { notificarWindows } from "./notificacao";

/**
 * Onde a iniciativa vira aviso de verdade.
 *
 * Existe separado do agendador porque a decisão de que algo venceu não deve
 * saber nada sobre navegador nem sobre Windows — assim o agendador continua
 * testável sem nada disso em volta.
 *
 * São dois caminhos, e os dois importam:
 *
 * - Tela aberta: o aviso vai pelo fluxo, ele fala e o cartão aparece.
 * - Tela fechada: notificação nativa do Windows, que é a maior parte do dia.
 *   Sem ela, um lembrete marcado para as 15h simplesmente não existiria se a
 *   aba não estivesse aberta.
 */

const TITULOS: Record<Iniciativa["tipo"], string> = {
  lembrete: "JARVIS · lembrete",
  rotina: "JARVIS",
  vigia: "JARVIS · atenção",
};

export function ligarEntregaDeIniciativas(): void {
  aoDisparar((iniciativa) => {
    const entregues = anunciarIniciativa(iniciativa);

    /*
     * A notificação do Windows só sai quando NÃO há tela aberta.
     *
     * Com a tela aberta ele já falou e mostrou o cartão; disparar o toast junto
     * seria o mesmo aviso duas vezes, e o dono acabaria desligando as
     * notificações — perdendo justamente o caso em que elas são a única via.
     */
    if (entregues > 0) return;

    void notificarWindows(TITULOS[iniciativa.tipo], iniciativa.texto).catch(() => {
      // Falhar em notificar não pode derrubar o relógio. O compromisso já foi
      // marcado como disparado; insistir aqui só multiplicaria o problema.
    });
  });

  iniciarAgendador();
}
