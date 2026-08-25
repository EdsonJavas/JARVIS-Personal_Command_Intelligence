/**
 * Renderiza o núcleo no formato da referência do filme: uma casca esférica de
 * arcos, franjas e blocos, com um nó caótico no centro. Orientação FIXA — o
 * conjunto não gira; o que se move é a energia dentro dele.
 *
 * Uso: node render-core.cjs <saida.png> [json de parâmetros]
 */
const fs = require("fs");
const zlib = require("zlib");

const SIZE = 760;
const TAU = Math.PI * 2;

const P = Object.assign(
  {
    arcs: 110,
    arcPoints: 26,
    spokes: 70,
    nucleusFibers: 260,
    nucleusPoints: 14,
    bands: 3,
    tickShare: 0.55,
    blockShare: 0.4,
    // fase da onda de ativação, 0..1
    wave: 0.35,
    seed: 987654,
    scaleFactor: 0.36,
    hue: 27,
  },
  JSON.parse(process.argv[3] || "{}")
);

let seed = P.seed;
function rnd() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function randomUnit() {
  const z = rnd() * 2 - 1;
  const a = rnd() * TAU;
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), r * Math.sin(a), z];
}
/** Base ortonormal (u, v) do plano perpendicular a n. */
function basisFor(n) {
  const seedVec = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = normalize(cross(n, seedVec));
  const v = cross(n, u);
  return [u, v];
}

// ------------------------------------------------------------ acumulador
const acc = new Float32Array(SIZE * SIZE * 3);

function splat(x, y, r, g, b, w) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  for (let dy = 0; dy <= 1; dy += 1) {
    for (let dx = 0; dx <= 1; dx += 1) {
      const px = xi + dx;
      const py = yi + dy;
      if (px < 0 || py < 0 || px >= SIZE || py >= SIZE) continue;
      const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * w;
      const idx = (py * SIZE + px) * 3;
      acc[idx] += r * weight;
      acc[idx + 1] += g * weight;
      acc[idx + 2] += b * weight;
    }
  }
}

function segment(x0, y0, x1, y1, col, alpha, width) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(dist * 2));
  const energy = (alpha * width) / 2;
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    splat(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, col[0], col[1], col[2], energy);
  }
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

// ------------------------------------------------------------- projeção
// Orientação FIXA. Uma inclinação leve só para o conjunto não ficar frontal
// demais; ela é constante, não animada.
const TILT = 0.32;
const cosT = Math.cos(TILT);
const sinT = Math.sin(TILT);
const cx = SIZE / 2;
const cy = SIZE / 2;
const scale = SIZE * P.scaleFactor;

function project(p) {
  const x = p[0];
  const y = p[1] * cosT - p[2] * sinT;
  const z = p[1] * sinT + p[2] * cosT;
  const persp = 1 / (2.1 - z * 0.42);
  return [cx + x * scale * persp * 2.1, cy + y * scale * persp * 2.1, z];
}

/**
 * Onda de ativação radial: uma faixa estreita que percorre o raio de dentro
 * para fora. É ela que dá vida sem precisar girar nada.
 */
function activation(radius) {
  const front = P.wave * 1.45 - 0.2;
  const d = Math.abs(radius - front);
  return Math.exp(-(d * d) / 0.012);
}

function render() {
  const col = hslToRgb(P.hue, 96, 52);
  const hot = hslToRgb(P.hue + 8, 70, 68);
  const dim = hslToRgb(P.hue - 4, 92, 44);
  // Núcleo com croma preservado: branco puro no miolo lê como estouro, não
  // como energia.
  const nucleusCol = hslToRgb(P.hue + 10, 88, 58);

  // ---------------------------------------------------- faixas largas
  // Discos inclinados, escuros: leem como planos orbitais atrás da estrutura.
  for (let b = 0; b < P.bands; b += 1) {
    const n = randomUnit();
    const [u, v] = basisFor(n);
    const radius = 1.02 + rnd() * 0.12;
    const steps = 200;
    let prev = null;
    for (let i = 0; i <= steps; i += 1) {
      const a = (i / steps) * TAU;
      const p = [
        (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * radius,
        (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * radius,
        (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * radius,
      ];
      const s = project(p);
      if (prev) segment(prev[0], prev[1], s[0], s[1], dim, 0.05, 9);
      prev = s;
    }
  }

  // ---------------------------------------------------------- arcos
  for (let a = 0; a < P.arcs; a += 1) {
    const n = randomUnit();
    const [u, v] = basisFor(n);
    // Três de cada quatro arcos ficam perto da superfície: é isso que faz a
    // estrutura ler como casca esférica em vez de disco preenchido.
    const onShell = rnd() < 0.75;
    const radius = onShell
      ? 0.86 + rnd() * 0.16
      : 0.34 + rnd() * 0.44;
    const start = rnd() * TAU;
    const extent = 0.35 + rnd() * 1.9;
    const act = activation(radius);
    const flicker = 0.72 + 0.28 * Math.sin(a * 2.3 + P.wave * 9);

    let prev = null;
    const pts = [];
    // Padrão de falhas: o arco não é contínuo, é uma sequência de traços com
    // interrupções. É isso que lê como trilha de circuito em vez de aro.
    const gapSeed = rnd();
    for (let i = 0; i < P.arcPoints; i += 1) {
      const ang = start + (i / (P.arcPoints - 1)) * extent;
      const p = [
        (u[0] * Math.cos(ang) + v[0] * Math.sin(ang)) * radius,
        (u[1] * Math.cos(ang) + v[1] * Math.sin(ang)) * radius,
        (u[2] * Math.cos(ang) + v[2] * Math.sin(ang)) * radius,
      ];
      pts.push(p);
      const s = project(p);
      const front = (s[2] + 1) / 2;
      const solid = Math.sin(i * 1.7 + gapSeed * 12) > -0.45;
      if (prev && solid) {
        const alpha = (0.16 + front * 0.42) * flicker * (1 + act * 2.6);
        segment(prev[0], prev[1], s[0], s[1], act > 0.35 ? hot : col, alpha, 0.9 + act * 1.2);
      }
      prev = s;
    }

    // franja radial: traços curtos apontando para fora, ao longo do arco
    if (rnd() < P.tickShare) {
      const every = 2 + ((rnd() * 2) | 0);
      const len = onShell ? 0.06 + rnd() * 0.1 : 0.03 + rnd() * 0.04;
      for (let i = 0; i < pts.length; i += every) {
        const p = pts[i];
        const outer = [p[0] * (1 + len), p[1] * (1 + len), p[2] * (1 + len)];
        const s0 = project(p);
        const s1 = project(outer);
        const front = (s0[2] + 1) / 2;
        segment(s0[0], s0[1], s1[0], s1[1], col, (0.14 + front * 0.36) * (1 + act * 2), 0.85);
      }
    }

    // blocos: trechos curtos e mais grossos, como nós de circuito
    if (rnd() < P.blockShare) {
      const i = 2 + ((rnd() * (pts.length - 4)) | 0);
      const s0 = project(pts[i]);
      const s1 = project(pts[i + 1]);
      const front = (s0[2] + 1) / 2;
      segment(s0[0], s0[1], s1[0], s1[1], hot, (0.4 + front * 0.6) * (1 + act * 1.5), 3.4);
    }
  }

  // ---------------------------------------------------------- raios
  for (let s = 0; s < P.spokes; s += 1) {
    const dir = randomUnit();
    const r0 = 0.3 + rnd() * 0.22;
    const r1 = r0 + 0.1 + rnd() * 0.26;
    const act = activation((r0 + r1) / 2);
    const a = project([dir[0] * r0, dir[1] * r0, dir[2] * r0]);
    const b = project([dir[0] * r1, dir[1] * r1, dir[2] * r1]);
    const front = (a[2] + 1) / 2;
    segment(a[0], a[1], b[0], b[1], col, (0.05 + front * 0.14) * (1 + act * 3), 0.7);
  }

  // -------------------------------------------------------- núcleo
  // Nó caótico e quente no miolo: é o foco luminoso da referência.
  for (let f = 0; f < P.nucleusFibers; f += 1) {
    let pos = randomUnit();
    let tan = normalize([rnd() - 0.5, rnd() - 0.5, rnd() - 0.5]);
    const baseR = 0.05 + Math.pow(rnd(), 0.62) * 0.32;
    const step = 0.05 + rnd() * 0.09;
    const curl = 0.7 + rnd() * 0.8;
    let prev = null;

    for (let i = 0; i < P.nucleusPoints; i += 1) {
      const p = [pos[0] * baseR, pos[1] * baseR, pos[2] * baseR];
      const s = project(p);
      if (prev) {
        const front = (s[2] + 1) / 2;
        segment(prev[0], prev[1], s[0], s[1], nucleusCol, 0.13 + front * 0.26, 0.8);
      }
      prev = s;

      pos = normalize([
        pos[0] + tan[0] * step,
        pos[1] + tan[1] * step,
        pos[2] + tan[2] * step,
      ]);
      const per = [
        tan[0] + (rnd() - 0.5) * curl,
        tan[1] + (rnd() - 0.5) * curl,
        tan[2] + (rnd() - 0.5) * curl,
      ];
      const d = per[0] * pos[0] + per[1] * pos[1] + per[2] * pos[2];
      tan = normalize([
        per[0] - pos[0] * d,
        per[1] - pos[1] * d,
        per[2] - pos[2] * d,
      ]);
    }
  }

  // brasa central
  const glowRadius = scale * 0.9;
  const [gr, gg, gb] = hslToRgb(P.hue + 4, 88, 56);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const d = Math.hypot(x - cx, y - cy) / glowRadius;
      if (d >= 1) continue;
      const a = 0.13 * Math.pow(1 - d, 2.4);
      const idx = (y * SIZE + x) * 3;
      acc[idx] += gr * a;
      acc[idx + 1] += gg * a;
      acc[idx + 2] += gb * a;
    }
  }
}

// ------------------------------------------------------------------ PNG
function toPng(path) {
  const raw = Buffer.alloc(SIZE * (SIZE * 3 + 1));
  let o = 0;
  for (let y = 0; y < SIZE; y += 1) {
    raw[o++] = 0;
    for (let x = 0; x < SIZE; x += 1) {
      const idx = (y * SIZE + x) * 3;
      for (let c = 0; c < 3; c += 1) {
        const v = 1 - Math.exp(-acc[idx + c] / 255);
        raw[o++] = Math.round(Math.min(255, v * 255));
      }
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  fs.writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
      chunk("IEND", Buffer.alloc(0)),
    ])
  );
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

render();
toPng(process.argv[2] || "core.png");
console.log("gerado:", process.argv[2]);
