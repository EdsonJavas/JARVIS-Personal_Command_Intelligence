/**
 * Dados do mundo real para o painel: clima, câmbio e manchetes.
 *
 * Todas as fontes são gratuitas e sem cadastro — nenhuma chave a gerenciar e
 * nada que expire. Cada uma tem cache próprio, dimensionado pelo ritmo em que o
 * dado realmente muda: câmbio se mexe a cada minuto, clima a cada dez, notícia
 * a cada quinze. O cache é servido na hora e a atualização acontece atrás, para
 * o painel nunca ficar esperando rede.
 */

type Cache<T> = { at: number; value: T } | null;

/** Serve o cache imediatamente e revalida em segundo plano quando vencido. */
function makeSource<T>(ttlMs: number, load: () => Promise<T>, empty: T) {
  let cache: Cache<T> = null;
  let inFlight: Promise<T> | null = null;

  return () => {
    const vencido = !cache || Date.now() - cache.at > ttlMs;
    if (vencido && !inFlight) {
      inFlight = load()
        .then((value) => {
          cache = { at: Date.now(), value };
          return value;
        })
        .catch((error) => {
          console.warn("[Mundo] falha ao atualizar:", String(error).slice(0, 140));
          return cache?.value ?? empty;
        })
        .finally(() => {
          inFlight = null;
        });
    }
    return cache?.value ?? empty;
  };
}

async function fetchJson<T>(url: string, timeoutMs = 12_000): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": "Jarvis/1.0" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} em ${url}`);
  return (await response.json()) as T;
}

/* ------------------------------ localização ------------------------------ */

export type Local = {
  cidade: string | null;
  regiao: string | null;
  latitude: number;
  longitude: number;
  fuso: string | null;
};

const LOCAL_PADRAO: Local = {
  cidade: null,
  regiao: null,
  latitude: -23.55,
  longitude: -46.63,
  fuso: "America/Sao_Paulo",
};

/**
 * Descobre onde a máquina está para o clima fazer sentido. Coordenadas fixas no
 * .env têm precedência: quem não quiser consultar serviço externo por IP define
 * WEATHER_LAT e WEATHER_LON e nada sai da máquina.
 */
let localCache: { at: number; value: Local } | null = null;
let localInFlight: Promise<Local> | null = null;

/**
 * Resolve a localização e DEVOLVE A PROMESSA. O clima precisa aguardá-la: se
 * lesse um cache ainda vazio, consultaria as coordenadas padrão e mostraria o
 * tempo de outra cidade — errado de um jeito silencioso, que ninguém percebe.
 */
function resolverLocal(): Promise<Local> {
  const vencido = !localCache || Date.now() - localCache.at > 6 * 60 * 60 * 1000;
  if (!vencido && localCache) return Promise.resolve(localCache.value);
  if (localInFlight) return localInFlight;

  localInFlight = (async () => {
    const lat = Number(process.env.WEATHER_LAT);
    const lon = Number(process.env.WEATHER_LON);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return {
        cidade: process.env.WEATHER_CITY ?? null,
        regiao: null,
        latitude: lat,
        longitude: lon,
        fuso: null,
      };
    }

    const data = await fetchJson<{
      status: string;
      city?: string;
      regionName?: string;
      lat?: number;
      lon?: number;
      timezone?: string;
    }>("http://ip-api.com/json/?fields=status,city,regionName,lat,lon,timezone");

    if (data.status !== "success" || data.lat === undefined || data.lon === undefined) {
      throw new Error("geolocalização por IP não resolveu");
    }

    return {
      cidade: data.city ?? null,
      regiao: data.regionName ?? null,
      latitude: data.lat,
      longitude: data.lon,
      fuso: data.timezone ?? null,
    };
  })()
    .then((value) => {
      localCache = { at: Date.now(), value };
      return value;
    })
    .catch(() => localCache?.value ?? LOCAL_PADRAO)
    .finally(() => {
      localInFlight = null;
    });

  return localInFlight;
}

/* --------------------------------- clima --------------------------------- */

export type Clima = {
  local: string | null;
  temperatura: number | null;
  sensacao: number | null;
  umidade: number | null;
  vento: number | null;
  codigo: number | null;
  descricao: string | null;
  dias: { data: string; maxima: number; minima: number; chuva: number }[];
};

const CLIMA_VAZIO: Clima = {
  local: null,
  temperatura: null,
  sensacao: null,
  umidade: null,
  vento: null,
  codigo: null,
  descricao: null,
  dias: [],
};

/** Tabela WMO usada pelo Open-Meteo, resumida ao que aparece por aqui. */
function descreverTempo(codigo: number | null): string | null {
  if (codigo === null) return null;
  if (codigo === 0) return "céu limpo";
  if (codigo <= 2) return "parcialmente nublado";
  if (codigo === 3) return "nublado";
  if (codigo <= 48) return "névoa";
  if (codigo <= 57) return "garoa";
  if (codigo <= 67) return "chuva";
  if (codigo <= 77) return "neve";
  if (codigo <= 82) return "pancadas de chuva";
  if (codigo <= 86) return "pancadas de neve";
  return "tempestade";
}

const clima = makeSource<Clima>(
  10 * 60 * 1000,
  async () => {
    const local = await resolverLocal();
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${local.latitude}&longitude=${local.longitude}` +
      "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m" +
      "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
      "&timezone=auto&forecast_days=4";

    const data = await fetchJson<{
      current: Record<string, number>;
      daily: {
        time: string[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        precipitation_probability_max: (number | null)[];
      };
    }>(url);

    const codigo = data.current.weather_code ?? null;

    return {
      local: [local.cidade, local.regiao].filter(Boolean).join("/") || null,
      temperatura: data.current.temperature_2m ?? null,
      sensacao: data.current.apparent_temperature ?? null,
      umidade: data.current.relative_humidity_2m ?? null,
      vento: data.current.wind_speed_10m ?? null,
      codigo,
      descricao: descreverTempo(codigo),
      dias: (data.daily.time ?? []).map((data_, index) => ({
        data: data_,
        maxima: data.daily.temperature_2m_max[index],
        minima: data.daily.temperature_2m_min[index],
        chuva: data.daily.precipitation_probability_max[index] ?? 0,
      })),
    };
  },
  CLIMA_VAZIO
);

/* -------------------------------- câmbio --------------------------------- */

export type Cotacao = {
  par: string;
  nome: string;
  valor: number;
  variacaoPercentual: number;
  minimo: number;
  maximo: number;
};

const cotacoes = makeSource<Cotacao[]>(
  2 * 60 * 1000,
  async () => {
    const data = await fetchJson<
      Record<
        string,
        {
          code: string;
          codein: string;
          name: string;
          bid: string;
          pctChange: string;
          low: string;
          high: string;
        }
      >
    >("https://economia.awesomeapi.com.br/last/USD-BRL,EUR-BRL,BTC-BRL");

    return Object.values(data).map((item) => ({
      par: `${item.code}/${item.codein}`,
      nome: item.name.split("/")[0].trim(),
      valor: Number(item.bid),
      variacaoPercentual: Number(item.pctChange),
      minimo: Number(item.low),
      maximo: Number(item.high),
    }));
  },
  []
);

/* ------------------------------- manchetes -------------------------------- */

export type Manchete = { titulo: string; link: string; quando: string | null };

const noticias = makeSource<Manchete[]>(
  15 * 60 * 1000,
  async () => {
    const response = await fetch("https://g1.globo.com/rss/g1/", {
      signal: AbortSignal.timeout(12_000),
      headers: { "user-agent": "Jarvis/1.0" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} no RSS`);
    const xml = await response.text();

    const limpar = (valor: string) =>
      valor
        .replace(/<!\[CDATA\[|\]\]>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim();

    const itens: Manchete[] = [];
    // O primeiro <title> do documento é o do canal, não de uma notícia; por
    // isso a varredura é por bloco <item>, não por <title> solto.
    const blocoRe = /<item>([\s\S]*?)<\/item>/g;
    let bloco: RegExpExecArray | null;

    while ((bloco = blocoRe.exec(xml)) !== null) {
      if (itens.length >= 8) break;
      const conteudo = bloco[1];
      const titulo = /<title>([\s\S]*?)<\/title>/.exec(conteudo);
      const link = /<link>([\s\S]*?)<\/link>/.exec(conteudo);
      const data = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(conteudo);
      if (!titulo) continue;
      itens.push({
        titulo: limpar(titulo[1]),
        link: link ? limpar(link[1]) : "",
        quando: data ? new Date(limpar(data[1])).toISOString() : null,
      });
    }

    return itens;
  },
  []
);

/* -------------------------------- agregado -------------------------------- */

export type MundoReal = {
  clima: Clima;
  cotacoes: Cotacao[];
  manchetes: Manchete[];
  medidoEm: string;
};

export function collectWorld(): MundoReal {
  return {
    clima: clima(),
    cotacoes: cotacoes(),
    manchetes: noticias(),
    medidoEm: new Date().toISOString(),
  };
}

/** Resumo em texto para o Jarvis responder sobre clima, câmbio e notícias. */
export function describeWorldForModel(mundo: MundoReal): string {
  const linhas: string[] = [];

  if (mundo.clima.temperatura !== null) {
    const c = mundo.clima;
    linhas.push(
      `Clima em ${c.local ?? "sua região"}: ${c.temperatura}°C, sensação de ${c.sensacao}°C, ` +
        `${c.descricao}, umidade ${c.umidade}%, vento ${c.vento} km/h.` +
        (c.dias[0]
          ? ` Hoje entre ${c.dias[0].minima}°C e ${c.dias[0].maxima}°C, ${c.dias[0].chuva}% de chance de chuva.`
          : "")
    );
  }

  if (mundo.cotacoes.length > 0) {
    linhas.push(
      "Câmbio: " +
        mundo.cotacoes
          .map(
            (c) =>
              `${c.nome} a ${c.valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} reais ` +
              `(${c.variacaoPercentual >= 0 ? "+" : ""}${c.variacaoPercentual.toFixed(2)}%)`
          )
          .join("; ") +
        "."
    );
  }

  if (mundo.manchetes.length > 0) {
    linhas.push(
      "Manchetes do momento: " +
        mundo.manchetes.slice(0, 5).map((m) => m.titulo).join("; ") +
        "."
    );
  }

  return linhas.join("\n");
}
