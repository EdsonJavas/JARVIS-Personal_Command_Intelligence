import type { Compromisso } from "../../drizzle/schema";
import { collectSystemStats } from "../systemStats";
import {
  listarCompromissos,
  rearmarVigia,
  registrarDisparo,
  vigiaDispara,
  vigiaNormalizou,
} from "./compromissos";

/**
 * O relógio do Jarvis.
 *
 * É a diferença entre um assistente que responde e um que procura o dono. Uma
 * volta a cada trinta segundos: fino o bastante para um lembrete de horário
 * cheio não atrasar de forma perceptível, e grosso o bastante para não pesar.
 *
 * Ele NÃO fala por conta própria daqui: apenas decide que algo venceu e entrega
 * a um ouvinte. Quem transforma isso em voz, cartão na tela ou notificação do
 * Windows é outra camada — assim o agendador continua testável sem navegador.
 */

const INTERVALO_MS = 30_000;

export type Iniciativa = {
  compromissoId: number;
  tipo: "lembrete" | "rotina" | "vigia";
  texto: string;
  em: number;
  /** Só nos vigias: o valor medido que provocou o aviso. */
  valor?: number;
};

type Ouvinte = (iniciativa: Iniciativa) => void;

const ouvintes = new Set<Ouvinte>();
let relogio: NodeJS.Timeout | null = null;
/** Uma volta por vez: uma varredura lenta não pode se sobrepor à seguinte. */
let rodando = false;

export function aoDisparar(ouvinte: Ouvinte): () => void {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

function anunciar(iniciativa: Iniciativa): void {
  for (const ouvinte of ouvintes) {
    try {
      ouvinte(iniciativa);
    } catch {
      /* um ouvinte quebrado não pode derrubar os outros nem parar o relógio */
    }
  }
}

/** Lê a métrica que um vigia observa. Nulo quando a máquina não informa. */
export function lerMetrica(
  metrica: Compromisso["metrica"],
  stats: ReturnType<typeof collectSystemStats>
): number | null {
  switch (metrica) {
    case "cpu":
      return stats.cpu.usagePercent;
    case "memoria":
      return stats.memory.usedPercent;
    case "disco": {
      // O disco do sistema é o que importa quando o espaço aperta.
      const alvo = stats.disks.find((disco) => disco.name.startsWith("C")) ?? stats.disks[0];
      return alvo ? alvo.usedPercent : null;
    }
    case "bateria":
      return stats.battery ? stats.battery.percent : null;
    case "temperatura":
      // Ainda não coletada; o vigia fica inerte em vez de disparar por engano.
      return null;
    default:
      return null;
  }
}

/**
 * Uma volta do relógio. Exportada para o teste poder chamá-la sem esperar.
 *
 * Devolve o que disparou, o que permite verificar a decisão sem depender de
 * ouvinte nenhum.
 */
export async function verificarVencidos(agora = new Date()): Promise<Iniciativa[]> {
  const ativos = await listarCompromissos();
  if (ativos.length === 0) return [];

  const disparadas: Iniciativa[] = [];

  // A telemetria só é lida se houver vigia: medir a máquina custa, e a maioria
  // das voltas do relógio não tem vigia nenhum para conferir.
  const temVigia = ativos.some((compromisso) => compromisso.tipo === "vigia");
  const stats = temVigia ? collectSystemStats() : null;

  for (const compromisso of ativos) {
    if (compromisso.tipo === "vigia") {
      if (!stats) continue;
      const valor = lerMetrica(compromisso.metrica, stats);

      if (vigiaNormalizou(compromisso, valor)) {
        await rearmarVigia(compromisso.id);
        continue;
      }
      if (!vigiaDispara(compromisso, valor)) continue;

      const iniciativa: Iniciativa = {
        compromissoId: compromisso.id,
        tipo: "vigia",
        texto: compromisso.texto,
        em: agora.getTime(),
        valor: valor ?? undefined,
      };
      await registrarDisparo(compromisso, agora);
      disparadas.push(iniciativa);
      continue;
    }

    if (!compromisso.proximaEm) continue;
    if (compromisso.proximaEm.getTime() > agora.getTime()) continue;

    const iniciativa: Iniciativa = {
      compromissoId: compromisso.id,
      tipo: compromisso.tipo,
      texto: compromisso.texto,
      em: agora.getTime(),
    };
    await registrarDisparo(compromisso, agora);
    disparadas.push(iniciativa);
  }

  return disparadas;
}

export function iniciarAgendador(): void {
  if (relogio) return;

  relogio = setInterval(() => {
    if (rodando) return;
    rodando = true;

    void verificarVencidos()
      .then((disparadas) => {
        for (const iniciativa of disparadas) anunciar(iniciativa);
      })
      .catch((erro) => {
        // Banco fora do ar não pode parar o relógio: a próxima volta tenta de
        // novo. Parar aqui deixaria o Jarvis mudo para sempre, sem sintoma.
        console.warn("[Agendador] volta falhou:", String(erro).slice(0, 140));
      })
      .finally(() => {
        rodando = false;
      });
  }, INTERVALO_MS);

  // Não segura o processo: o servidor deve poder encerrar normalmente.
  relogio.unref?.();
  console.log("[Agendador] relógio ligado.");
}

export function pararAgendador(): void {
  if (!relogio) return;
  clearInterval(relogio);
  relogio = null;
}
