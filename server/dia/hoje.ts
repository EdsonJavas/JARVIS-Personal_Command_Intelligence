import { chamarFerramenta, servidoresConectados } from "../mcp/ponte";
import { listarCompromissos } from "../tempo/compromissos";
import { collectDevLife } from "../devLife";

/**
 * O dia do dono, montado pelo servidor, sem gastar cota.
 *
 * A agenda e os e-mails vêm pela ponte MCP — a mesma que o modelo usa —
 * chamada direto, em leitura. Os servidores devolvem TEXTO livre, não JSON,
 * então cada um tem um leitor tolerante: o que não casar vira uma linha crua,
 * nunca um erro. Um painel que quebra porque a agenda mudou o formato da
 * data é pior que um painel que mostra a linha como veio.
 *
 * O briefing é composto daqui, por regra, e não pelo modelo: "duas reuniões,
 * a próxima em 19 minutos" é conta, não redação. Cota é o recurso mais
 * escasso do projeto e não se gasta com o que uma função faz.
 */

export type Evento = {
  titulo: string;
  inicio: string | null;
  fim: string | null;
  local: string | null;
  /** Como veio, para quando o leitor não entendeu. */
  cru: string;
};

export type Email = {
  de: string;
  assunto: string;
  quando: string | null;
  previa: string;
  /** Parece pedir resposta do dono: pergunta, prazo, "urgente", "por favor". */
  pedeResposta: boolean;
};

export type Hoje = {
  data: string;
  agenda: { ligada: boolean; eventos: Evento[] };
  email: { ligado: boolean; naoLidos: Email[] };
  briefing: string;
  numeros: { reunioes: number; emailsQuePedem: number; reposComPendencia: number; compromissos: number };
  medidoEm: string;
};

const CACHE_MS = 5 * 60 * 1000;
let cache: { valor: Hoje; em: number } | null = null;
let emCurso: Promise<Hoje> | null = null;

/* ---------------------------------- leitores -------------------------------- */

const HORA_ISO = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:[.\d]*)?(?:Z|[+-]\d{2}:?\d{2})?)/;
const HORA_CURTA = /\b(\d{1,2}:\d{2})\b/;

/** Blocos separados por linha em branco; cada bloco, um evento. */
export function lerAgenda(texto: string): Evento[] {
  const blocos = texto
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length > 0 && !/^(no events|nenhum evento|found \d+ event)/i.test(b));

  return blocos.slice(0, 20).map((bloco) => {
    const linhas = bloco.split("\n").map((l) => l.trim()).filter(Boolean);
    const campo = (chave: RegExp) => {
      const linha = linhas.find((l) => chave.test(l));
      return linha ? linha.replace(chave, "").trim() : null;
    };
    const inicioLinha = campo(/^(start|início|inicio|when|quando)\s*:/i);
    const fimLinha = campo(/^(end|fim|até|ate)\s*:/i);
    const titulo =
      campo(/^(title|título|titulo|summary|evento)\s*:/i) ??
      linhas.find((l) => !/^\w+\s*:/.test(l)) ??
      linhas[0] ??
      "(sem título)";

    return {
      titulo: titulo.replace(/^[-*•]\s*/, "").slice(0, 120),
      inicio: extrairHora(inicioLinha ?? bloco),
      fim: fimLinha ? extrairHora(fimLinha) : null,
      local: campo(/^(location|local|onde)\s*:/i),
      cru: bloco.slice(0, 400),
    };
  });
}

function extrairHora(texto: string | null): string | null {
  if (!texto) return null;
  const iso = HORA_ISO.exec(texto);
  if (iso) {
    const d = new Date(iso[1]);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const curta = HORA_CURTA.exec(texto);
  if (curta) {
    const [h, m] = curta[1].split(":").map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  }
  return null;
}

const PEDE_RESPOSTA = /\?|urgente|urgent|prazo|deadline|por favor|please|pode |consegue|precisamos|aguardo|até (hoje|amanhã|sexta)|asap|responda|confirma/i;

/** Uma linha ou bloco por mensagem; campos "From/Subject/Date" quando vierem. */
export function lerEmails(texto: string): Email[] {
  const blocos = texto
    .split(/\n\s*\n|\n(?=(?:id|ID|message)\s*[:#])/i)
    .map((b) => b.trim())
    .filter((b) => b.length > 0 && !/^(no (emails|messages)|nenhum)/i.test(b));

  return blocos.slice(0, 15).map((bloco) => {
    const linhas = bloco.split("\n").map((l) => l.trim()).filter(Boolean);
    const campo = (chave: RegExp) => {
      const linha = linhas.find((l) => chave.test(l));
      return linha ? linha.replace(chave, "").trim() : null;
    };
    const de = campo(/^(from|de)\s*:/i) ?? "";
    const assunto = campo(/^(subject|assunto)\s*:/i) ?? linhas[0] ?? "";
    const quando = campo(/^(date|data)\s*:/i);
    const previa = campo(/^(snippet|preview|prévia|previa)\s*:/i) ?? "";
    const corpo = `${assunto} ${previa}`;
    return {
      de: limparRemetente(de).slice(0, 60),
      assunto: assunto.slice(0, 140),
      quando: quando ? extrairHora(quando) ?? quando.slice(0, 40) : null,
      previa: previa.slice(0, 200),
      pedeResposta: PEDE_RESPOSTA.test(corpo) && !/no-?reply|noreply|newsletter|unsubscribe/i.test(de),
    };
  });
}

function limparRemetente(de: string): string {
  const nome = /^"?([^"<]+?)"?\s*<[^>]+>$/.exec(de);
  return (nome ? nome[1] : de).trim();
}

/* --------------------------------- briefing --------------------------------- */

function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`;
}

export function redigirBriefing(entrada: {
  eventos: Evento[];
  emailsQuePedem: number;
  reposComPendencia: number;
  compromissos: number;
  agora?: Date;
}): string {
  const agora = entrada.agora ?? new Date();
  const partes: string[] = [];

  const futuros = entrada.eventos
    .filter((e) => e.inicio && new Date(e.inicio).getTime() > agora.getTime() - 5 * 60_000)
    .sort((a, b) => (a.inicio ?? "").localeCompare(b.inicio ?? ""));
  if (entrada.eventos.length === 0) partes.push("Agenda livre hoje.");
  else {
    let frase = `${plural(entrada.eventos.length, "compromisso na agenda", "compromissos na agenda")}`;
    const proximo = futuros[0];
    if (proximo?.inicio) {
      const min = Math.round((new Date(proximo.inicio).getTime() - agora.getTime()) / 60_000);
      frase += min <= 0 ? `, "${proximo.titulo}" agora` : min < 90 ? `, o próximo em ${min} min: ${proximo.titulo}` : `, o próximo às ${new Date(proximo.inicio).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}: ${proximo.titulo}`;
    }
    partes.push(`${frase}.`);
  }

  if (entrada.emailsQuePedem > 0) partes.push(`${plural(entrada.emailsQuePedem, "e-mail pede", "e-mails pedem")} resposta.`);
  if (entrada.reposComPendencia > 0) partes.push(`${plural(entrada.reposComPendencia, "repositório com pendência", "repositórios com pendência")}.`);
  if (entrada.compromissos > 0) partes.push(`${plural(entrada.compromissos, "lembrete marcado", "lembretes marcados")} comigo.`);

  return partes.join(" ");
}

/* ----------------------------------- coleta --------------------------------- */

async function coletar(): Promise<Hoje> {
  const conectados = servidoresConectados();
  const inicioDoDia = new Date();
  inicioDoDia.setHours(0, 0, 0, 0);
  const fimDoDia = new Date(inicioDoDia.getTime() + 24 * 3600_000);

  const [agendaTexto, emailTexto, compromissos, dev] = await Promise.all([
    conectados.includes("agenda")
      ? chamarFerramenta("agenda", "list-events", {
          calendarId: "primary",
          timeMin: inicioDoDia.toISOString(),
          timeMax: fimDoDia.toISOString(),
        })
      : Promise.resolve(null),
    conectados.includes("email")
      ? chamarFerramenta("email", "search_emails", { query: "is:unread newer_than:2d", maxResults: 12 })
      : Promise.resolve(null),
    listarCompromissos().catch(() => []),
    Promise.resolve(collectDevLife()),
  ]);

  const eventos = agendaTexto?.ok ? lerAgenda(agendaTexto.texto) : [];
  const naoLidos = emailTexto?.ok ? lerEmails(emailTexto.texto) : [];
  const emailsQuePedem = naoLidos.filter((e) => e.pedeResposta).length;
  const reposComPendencia = dev.repositorios.filter((r) => r.alterados + r.naoRastreados + r.aFrente + r.atras > 0).length;

  return {
    data: inicioDoDia.toISOString(),
    agenda: { ligada: conectados.includes("agenda"), eventos },
    email: { ligado: conectados.includes("email"), naoLidos },
    briefing: redigirBriefing({ eventos, emailsQuePedem, reposComPendencia, compromissos: compromissos.length }),
    numeros: { reunioes: eventos.length, emailsQuePedem, reposComPendencia, compromissos: compromissos.length },
    medidoEm: new Date().toISOString(),
  };
}

/** Devolve o cache na hora e renova em segundo plano quando venceu. */
export async function hoje(): Promise<Hoje> {
  if (cache && Date.now() - cache.em < CACHE_MS) return cache.valor;
  if (!emCurso) {
    emCurso = coletar()
      .then((valor) => {
        cache = { valor, em: Date.now() };
        return valor;
      })
      .finally(() => {
        emCurso = null;
      });
  }
  // Com cache vencido mas existente, responde o antigo e deixa o novo chegar.
  return cache ? cache.valor : emCurso;
}
