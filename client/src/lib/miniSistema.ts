/**
 * As contas do mini sistema da ilha, longe do desenho.
 *
 * Tudo aqui é função pura sobre um `agora` recebido: "em 25 min" e "amanhã às
 * 09:00" dependem do relógio, e sem recebê-lo não haveria como testar.
 */

const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const DIAS_LONGOS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];
const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

const doisDigitos = (n: number) => String(n).padStart(2, "0");
const hora = (data: Date) => `${doisDigitos(data.getHours())}:${doisDigitos(data.getMinutes())}`;

export function saudacao(agora: Date): string {
  const h = agora.getHours();
  if (h >= 5 && h < 12) return "Bom dia";
  if (h >= 12 && h < 18) return "Boa tarde";
  return "Boa noite";
}

export function dataPorExtenso(agora: Date): string {
  return `${DIAS_LONGOS[agora.getDay()]}, ${agora.getDate()} de ${MESES[agora.getMonth()]}`;
}

function mesmoDia(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Quanto falta, do jeito que se fala: perto em minutos, longe pela data.
 */
export function quandoFalta(iso: string | null, agora: Date): string {
  if (!iso) return "sem data";
  const quando = new Date(iso);
  const minutos = (quando.getTime() - agora.getTime()) / 60_000;

  if (minutos < -1) return "atrasado";
  if (minutos < 1) return "agora";
  if (minutos < 60) return `em ${Math.round(minutos)} min`;
  if (mesmoDia(quando, agora)) return `hoje às ${hora(quando)}`;

  const amanha = new Date(agora);
  amanha.setDate(agora.getDate() + 1);
  if (mesmoDia(quando, amanha)) return `amanhã às ${hora(quando)}`;

  return `${DIAS_CURTOS[quando.getDay()]}, ${doisDigitos(quando.getDate())}/${doisDigitos(
    quando.getMonth() + 1
  )} às ${hora(quando)}`;
}

/** "dias úteis às 18:30". `horaDoDia` em minutos desde a meia-noite. */
export function descreverRotina(horaDoDia: number | null, diasDaSemana: string | null): string {
  if (horaDoDia === null || horaDoDia === undefined) return "sem horário";
  const horario = `${doisDigitos(Math.floor(horaDoDia / 60))}:${doisDigitos(horaDoDia % 60)}`;

  const dias = [
    ...new Set(
      (diasDaSemana ?? "")
        .split(",")
        // Vazio NÃO é domingo: Number("") dá zero.
        .filter((d) => d.trim() !== "")
        .map((d) => Number(d.trim()))
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    ),
  ].sort((a, b) => a - b);

  const chave = dias.join(",");
  if (dias.length === 0 || dias.length === 7) return `todo dia às ${horario}`;
  if (chave === "1,2,3,4,5") return `dias úteis às ${horario}`;
  if (chave === "0,6") return `fins de semana às ${horario}`;

  const nomes = dias.map((d) => DIAS_CURTOS[d]);
  const lista = nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
  return `${lista} às ${horario}`;
}

const NOMES_DE_METRICA: Record<string, string> = {
  cpu: "CPU",
  memoria: "memória",
  disco: "disco",
  bateria: "bateria",
  temperatura: "temperatura",
};

export function descreverVigia(
  metrica: string | null,
  comparacao: string | null,
  limite: number | null
): string {
  if (!metrica || !comparacao || limite === null) return "vigia";
  const unidade = metrica === "temperatura" ? "°C" : "%";
  return `${NOMES_DE_METRICA[metrica] ?? metrica} ${comparacao} de ${limite}${unidade}`;
}

type ComTipo = { tipo: "lembrete" | "rotina" | "vigia" };

export function separarCompromissos<T extends ComTipo>(lista: T[]) {
  return {
    lembretes: lista.filter((c) => c.tipo === "lembrete"),
    rotinas: lista.filter((c) => c.tipo === "rotina"),
    vigias: lista.filter((c) => c.tipo === "vigia"),
  };
}

const semAcento = (texto: string) =>
  texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

type Lembravel = { conteudo: string; esquecida: boolean };

/** Busca sem acento nem caixa: "salvadór" acha "Salvador". */
export function filtrarMemorias<T extends Lembravel>(lista: T[], busca: string) {
  const termo = semAcento(busca.trim());
  const casa = (m: T) => !termo || semAcento(m.conteudo).includes(termo);
  return {
    ativas: lista.filter((m) => !m.esquecida && casa(m)),
    esquecidas: lista.filter((m) => m.esquecida && casa(m)),
  };
}
