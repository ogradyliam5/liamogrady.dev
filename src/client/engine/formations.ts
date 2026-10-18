/**
 * Procedural formations: every shape the swarm can become is generated from code
 * at runtime — no models, no textures, no images. Points are xyz + w (tint 0..1).
 */
import type { Shape } from './types';
import { rng } from './math';

const TAU = Math.PI * 2;

class Builder {
  readonly data: Float32Array;
  n = 0;
  constructor(readonly capacity: number) {
    this.data = new Float32Array(capacity * 4);
  }
  push(x: number, y: number, z: number, w = 0): boolean {
    if (this.n >= this.capacity) return false;
    const o = this.n * 4;
    this.data[o] = x;
    this.data[o + 1] = y;
    this.data[o + 2] = z;
    this.data[o + 3] = w;
    this.n++;
    return true;
  }
  shape(name: string, jitter: number): Shape {
    return { name, points: this.data.subarray(0, this.n * 4), count: Math.max(1, this.n), jitter };
  }
}

function gauss(r: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = r();
  while (v === 0) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}

function rotX(x: number, y: number, z: number, a: number): [number, number, number] {
  const c = Math.cos(a), s = Math.sin(a);
  return [x, y * c - z * s, y * s + z * c];
}
function rotY(x: number, y: number, z: number, a: number): [number, number, number] {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c + z * s, y, -x * s + z * c];
}
function rotZ(x: number, y: number, z: number, a: number): [number, number, number] {
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c, z];
}

/** The orchestrator: a bright core with agents on tilted orbits around it. */
export function orbits(K = 65536, seed = 7): Shape {
  const r = rng(seed);
  const b = new Builder(K);
  const rings = [
    { R: 0.62, tiltX: 1.15, tiltZ: 0.25, w: 0.9, share: 0.17 },
    { R: 0.82, tiltX: 1.35, tiltZ: -0.55, w: 0.2, share: 0.2 },
    { R: 1.02, tiltX: 0.95, tiltZ: 0.9, w: 0.55, share: 0.2 },
    { R: 1.22, tiltX: 1.5, tiltZ: -0.15, w: 0.1, share: 0.18 },
    { R: 0.45, tiltX: 0.4, tiltZ: 1.6, w: 1.0, share: 0.1 },
  ];
  const core = Math.floor(K * 0.15);
  for (let i = 0; i < core; i++) {
    const rad = Math.pow(r(), 2.2) * 0.26;
    const u = r() * 2 - 1, th = r() * TAU, s = Math.sqrt(1 - u * u);
    b.push(rad * s * Math.cos(th), rad * s * Math.sin(th), rad * u, 1);
  }
  for (const ring of rings) {
    const count = Math.floor(K * ring.share);
    // agents cluster in beads along each orbit
    const beads = 7 + Math.floor(r() * 6);
    for (let i = 0; i < count; i++) {
      const bead = Math.floor(r() * beads);
      const along = bead / beads + (r() < 0.6 ? gauss(r) * 0.012 : r()) ;
      const a = along * TAU;
      const thick = r() < 0.6 ? 0.012 : 0.035;
      let [x, y, z] = [Math.cos(a) * ring.R + gauss(r) * thick, Math.sin(a) * ring.R + gauss(r) * thick, gauss(r) * thick];
      [x, y, z] = rotX(x, y, z, ring.tiltX);
      [x, y, z] = rotZ(x, y, z, ring.tiltZ);
      b.push(x, y, z, ring.w);
    }
  }
  while (b.n < K) {
    // sparse halo
    const rad = 1.3 + r() * 0.6;
    const u = r() * 2 - 1, th = r() * TAU, s = Math.sqrt(1 - u * u);
    b.push(rad * s * Math.cos(th), rad * s * Math.sin(th) * 0.7, rad * u * 0.6, 0.3);
  }
  return b.shape('orbits', 0.01);
}

/** Text sampled from a 2D canvas (needs the font loaded). Width normalised to 2 units. */
export function text(lines: string[], font: string, K = 49152, name = 'text', seed = 3): Shape {
  const r = rng(seed);
  const W = 1400;
  const H = 260 * lines.length;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // `font` is a full CSS font shorthand ("italic 400 200px Family"); only its size is replaced.
  const at = (px: number) => (/\d+(\.\d+)?px/.test(font) ? font.replace(/\d+(\.\d+)?px/, `${px}px`) : `${px}px ${font}`);
  let size = 220;
  g.font = at(size);
  const widest = Math.max(1, ...lines.map((l) => g.measureText(l).width));
  size = Math.min(220, Math.floor((size * (W * 0.94)) / widest));
  g.font = at(size);
  lines.forEach((l, i) => g.fillText(l, W / 2, (i + 0.5) * (H / lines.length)));
  const img = g.getImageData(0, 0, W, H).data;
  const filled: number[] = [];
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (img[(y * W + x) * 4 + 3]! > 128) filled.push(x, y);
  const b = new Builder(K);
  const total = filled.length / 2;
  if (!total) return orbits(K);
  // bounding box for normalisation
  let minX = W, maxX = 0, minY = H, maxY = 0;
  for (let i = 0; i < total; i++) {
    const x = filled[i * 2]!, y = filled[i * 2 + 1]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const scale = 2 / (maxX - minX);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  for (let i = 0; i < K; i++) {
    const j = Math.floor(r() * total);
    const x = (filled[j * 2]! + r() * 2 - cx) * scale;
    const y = -(filled[j * 2 + 1]! + r() * 2 - cy) * scale;
    b.push(x, y, gauss(r) * 0.012, r() < 0.12 ? 1 : 0.15);
  }
  return b.shape(name, 0.004);
}

/** Galway fields: a rolling landscape cut into fields by dry-stone walls, seen from above at an angle. */
export function fields(K = 65536, seed = 11): Shape {
  const r = rng(seed);
  const b = new Builder(K);
  // jittered grid of field corners → walls along cell edges
  const G = 9;
  const pts: [number, number][][] = [];
  for (let j = 0; j <= G; j++) {
    const row: [number, number][] = [];
    for (let i = 0; i <= G; i++) {
      const edge = i === 0 || j === 0 || i === G || j === G;
      row.push([(i / G) * 2 - 1 + (edge ? 0 : (r() - 0.5) * 0.14), (j / G) * 2 - 1 + (edge ? 0 : (r() - 0.5) * 0.14)]);
    }
    pts.push(row);
  }
  const height = (x: number, y: number) =>
    0.09 * Math.sin(x * 2.1 + 0.6) * Math.cos(y * 1.7 - 0.3) + 0.045 * Math.sin(x * 5.3 + y * 3.1) + 0.02 * Math.sin(x * 11.0 - y * 7.0);
  const place = (x: number, y: number, z: number, w: number) => {
    const [px, py, pz] = rotX(x * 1.25, y * 1.0, z, -1.05);
    b.push(px, py - 0.05, pz, w);
  };
  const wallShare = 0.42;
  const walls = Math.floor(K * wallShare);
  const segs: [number, number, number, number][] = [];
  for (let j = 0; j <= G; j++)
    for (let i = 0; i <= G; i++) {
      const p = pts[j]![i]!;
      if (i < G && r() > 0.08) segs.push([p[0], p[1], pts[j]![i + 1]![0], pts[j]![i + 1]![1]]);
      if (j < G && r() > 0.08) segs.push([p[0], p[1], pts[j + 1]![i]![0], pts[j + 1]![i]![1]]);
    }
  for (let i = 0; i < walls; i++) {
    const s = segs[Math.floor(r() * segs.length)]!;
    const t = r();
    const x = s[0] + (s[2] - s[0]) * t + gauss(r) * 0.004;
    const y = s[1] + (s[3] - s[1]) * t + gauss(r) * 0.004;
    place(x, y, height(x, y) + 0.018 + Math.abs(gauss(r)) * 0.012, 0.95);
  }
  while (b.n < K) {
    const x = r() * 2 - 1, y = r() * 2 - 1;
    place(x, y, height(x, y) + gauss(r) * 0.004, 0.08 + r() * 0.1);
  }
  return b.shape('fields', 0.006);
}

export type GraphNode = { id: string; x: number; y: number; z?: number; size?: number; hot?: boolean };
export type GraphEdge = [string, string];

/** Nodes as dense clusters, edges as luminous filaments with a slight arc. */
export function graph(nodes: GraphNode[], edges: GraphEdge[], K = 65536, name = 'graph', seed = 5): Shape {
  const r = rng(seed);
  const b = new Builder(K);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const nodeShare = 0.38;
  const per = Math.floor((K * nodeShare) / nodes.length);
  for (const n of nodes) {
    const size = (n.size ?? 1) * 0.07;
    for (let i = 0; i < per; i++) {
      const rad = Math.pow(r(), 1.6) * size;
      const u = r() * 2 - 1, th = r() * TAU, s = Math.sqrt(1 - u * u);
      b.push(n.x + rad * s * Math.cos(th), n.y + rad * s * Math.sin(th), (n.z ?? 0) + rad * u, n.hot ? 1 : 0.7);
    }
  }
  const edgeList = edges.map(([a, c]) => [byId.get(a)!, byId.get(c)!] as const).filter(([a, c]) => a && c);
  while (b.n < K && edgeList.length) {
    const [a, c] = edgeList[Math.floor(r() * edgeList.length)]!;
    const t = r();
    const mx = (a.x + c.x) / 2, my = (a.y + c.y) / 2;
    const dx = c.x - a.x, dy = c.y - a.y;
    const bow = 0.08;
    const cx = mx - dy * bow, cy = my + dx * bow;
    const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * cx + t * t * c.x;
    const y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * cy + t * t * c.y;
    const z = (1 - t) * (a.z ?? 0) + t * (c.z ?? 0) + Math.sin(t * Math.PI) * 0.05;
    b.push(x + gauss(r) * 0.006, y + gauss(r) * 0.006, z + gauss(r) * 0.006, 0.25);
  }
  return b.shape(name, 0.004);
}

/** A five-string banjo, drawn in light: pot, head, neck, frets, strings, pegs. */
export function banjo(K = 65536, seed = 13): Shape {
  const r = rng(seed);
  const b = new Builder(K);
  const potX = 0.0, potY = -0.42, potR = 0.42;
  // held as if being played: neck to the right, about 20 degrees above horizontal
  const tilt = -1.22;
  const put = (x: number, y: number, z: number, w: number) => {
    const [a, c, d] = rotZ(x, y, z, tilt);
    b.push(a, c + 0.05, d, w);
  };
  const share = (f: number) => Math.floor(K * f);
  // rim (bright ring) and tension hooks
  for (let i = 0; i < share(0.2); i++) {
    const a = r() * TAU;
    const rr = potR + gauss(r) * 0.008;
    put(potX + Math.cos(a) * rr, potY + Math.sin(a) * rr, gauss(r) * 0.01, 1);
  }
  for (let i = 0; i < share(0.06); i++) {
    const hook = Math.floor(r() * 24);
    const a = (hook / 24) * TAU;
    const rr = potR + 0.02 + r() * 0.035;
    put(potX + Math.cos(a) * rr, potY + Math.sin(a) * rr, 0, 0.9);
  }
  // head (faint disc)
  for (let i = 0; i < share(0.16); i++) {
    const a = r() * TAU;
    const rr = Math.sqrt(r()) * (potR - 0.02);
    put(potX + Math.cos(a) * rr, potY + Math.sin(a) * rr, gauss(r) * 0.004, 0.06);
  }
  // neck
  const neckTop = 1.28, neckW = 0.075;
  for (let i = 0; i < share(0.14); i++) {
    const y = potY + potR * 0.6 + r() * (neckTop - potY - potR * 0.6);
    const edge = r() < 0.5 ? -1 : 1;
    put(edge * neckW + gauss(r) * 0.004, y, 0, 0.55);
  }
  // frets
  for (let i = 0; i < share(0.05); i++) {
    const f = Math.floor(r() * 17) + 1;
    const y = potY + potR + (1 - Math.pow(2, -f / 12)) * 1.9;
    if (y > neckTop) continue;
    put((r() * 2 - 1) * neckW, y, 0, 0.5);
  }
  // headstock
  for (let i = 0; i < share(0.05); i++) {
    const y = neckTop + r() * 0.2;
    const w = neckW * (1 + (y - neckTop) * 1.8);
    put((r() * 2 - 1) * w, y, 0, 0.45);
  }
  // strings: 4 long + the short 5th string with its side peg
  for (let i = 0; i < share(0.22); i++) {
    const s = Math.floor(r() * 5);
    const x0 = -0.045 + s * 0.0225;
    const yStart = potY - potR * 0.55;
    const yEnd = s === 4 ? potY + potR + 0.62 : neckTop;
    const y = yStart + r() * (yEnd - yStart);
    put(x0 + (s === 4 ? 0.012 : 0) + gauss(r) * 0.0018, y, 0.01, 0.95);
  }
  // tailpiece + bridge
  for (let i = 0; i < share(0.03); i++) {
    put((r() * 2 - 1) * 0.07, potY - potR * 0.25 + gauss(r) * 0.006, 0.01, 1);
  }
  while (b.n < K) {
    // floating notes of light drifting off the strings
    const a = r() * TAU;
    const rr = 0.55 + r() * 0.9;
    put(Math.cos(a) * rr * 1.1, potY + 0.4 + Math.sin(a) * rr * 0.8, gauss(r) * 0.2, 0.2);
  }
  return b.shape('banjo', 0.004);
}

/** Hexagonal badges in a gentle arc, one per credential. */
export function badges(count: number, K = 65536, seed = 17): Shape {
  const r = rng(seed);
  const b = new Builder(K);
  const spacing = 2.2 / Math.max(1, count);
  const R = Math.min(0.24, spacing * 0.45);
  for (let i = 0; b.n < K; i++) {
    const k = Math.floor(r() * count);
    const cx = (k - (count - 1) / 2) * spacing;
    const cy = -Math.abs(k - (count - 1) / 2) * 0.06 + 0.03;
    const expert = k < 2;
    const roll = r();
    if (roll < 0.55) {
      // outline
      const side = Math.floor(r() * 6);
      const t = r();
      const a0 = (side / 6) * TAU + Math.PI / 6, a1 = ((side + 1) / 6) * TAU + Math.PI / 6;
      const x = Math.cos(a0) * R * (1 - t) + Math.cos(a1) * R * t;
      const y = Math.sin(a0) * R * (1 - t) + Math.sin(a1) * R * t;
      b.push(cx + x + gauss(r) * 0.003, cy + y + gauss(r) * 0.003, gauss(r) * 0.006, expert ? 1 : 0.6);
    } else if (roll < 0.75) {
      // inner ring
      const a = r() * TAU;
      b.push(cx + Math.cos(a) * R * 0.55, cy + Math.sin(a) * R * 0.55, 0, expert ? 0.95 : 0.4);
    } else {
      // faint fill
      const a = r() * TAU, rr = Math.sqrt(r()) * R * 0.85;
      b.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, gauss(r) * 0.01, 0.1);
    }
  }
  return b.shape('badges', 0.003);
}

/** Fibonacci-sphere globe with latitude lines, for "the world is listening". */
export function globe(K = 65536, seed = 19): Shape {
  const r = rng(seed);
  const b = new Builder(K);
  const g = Math.PI * (3 - Math.sqrt(5));
  const dots = Math.floor(K * 0.6);
  for (let i = 0; i < dots; i++) {
    const y = 1 - (i / (dots - 1)) * 2;
    const rad = Math.sqrt(1 - y * y);
    const th = g * i;
    const [x, yy, z] = rotX(Math.cos(th) * rad, y, Math.sin(th) * rad, 0.35);
    b.push(x * 0.95, yy * 0.95, z * 0.95, 0.15);
  }
  while (b.n < K) {
    const lat = (Math.floor(r() * 9) - 4) * (Math.PI / 10);
    const a = r() * TAU;
    const [x, y, z] = rotX(Math.cos(a) * Math.cos(lat), Math.sin(lat), Math.sin(a) * Math.cos(lat), 0.35);
    b.push(x * 0.96, y * 0.96, z * 0.96, 0.7);
  }
  return b.shape('globe', 0.004);
}

/** Calm, wide scatter used while nothing in particular is on screen. */
export function drift(K = 65536, seed = 23): Shape {
  const r = rng(seed);
  const b = new Builder(K);
  while (b.n < K) {
    const x = (r() * 2 - 1) * 2.4;
    const y = (r() * 2 - 1) * 1.4;
    const z = gauss(r) * 0.5 - 0.4;
    b.push(x, y, z, r() < 0.05 ? 1 : 0.1);
  }
  return b.shape('drift', 0.02);
}

export { rotX, rotY, rotZ };
