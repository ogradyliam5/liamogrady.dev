/**
 * The site's formations. Each is generated from code the first time it is needed.
 */
import { orbits, fields, graph, banjo, badges, globe, drift, text, type GraphNode, type GraphEdge } from './engine/formations';
import type { Shape } from './engine/types';
import { rng } from './engine/math';

/** Rough coastlines of Ireland and Great Britain [lon, lat], enough for a dot-matrix map. */
const IRELAND: [number, number][] = [
  [-7.37, 55.38], [-6.15, 55.22], [-5.7, 54.66], [-5.45, 54.4], [-6.1, 54.02], [-6.3, 53.95], [-6.1, 53.35],
  [-5.99, 52.97], [-6.36, 52.17], [-6.93, 52.12], [-7.85, 51.95], [-8.25, 51.79], [-8.53, 51.6], [-9.82, 51.45],
  [-10.2, 51.6], [-10.4, 51.9], [-10.5, 52.1], [-9.9, 52.42], [-9.93, 52.56], [-9.3, 53.1], [-9.05, 53.27],
  [-10.2, 53.4], [-10.1, 53.95], [-9.99, 54.3], [-9.35, 54.32], [-8.6, 54.3], [-8.3, 54.6], [-8.6, 54.75],
  [-8.3, 55.15], [-7.6, 55.25],
];
const BRITAIN: [number, number][] = [
  [-5.7, 50.07], [-5.2, 49.96], [-4.15, 50.35], [-3.4, 50.6], [-2.45, 50.52], [-1.1, 50.75], [0.25, 50.73],
  [1.38, 51.13], [1.44, 51.38], [0.8, 51.5], [1.3, 51.95], [1.75, 52.48], [1.3, 52.93], [0.3, 52.95],
  [0.11, 53.58], [-0.08, 54.12], [-0.6, 54.49], [-1.42, 55.0], [-2.0, 55.77], [-3.0, 56.0], [-2.58, 56.28],
  [-2.1, 57.15], [-1.82, 57.6], [-3.4, 57.7], [-4.2, 57.5], [-3.9, 58.0], [-3.03, 58.64], [-3.37, 58.67],
  [-5.0, 58.62], [-5.16, 57.9], [-5.7, 57.28], [-6.22, 56.73], [-5.47, 56.41], [-5.8, 55.3], [-4.63, 55.46],
  [-4.86, 54.64], [-3.5, 54.9], [-3.23, 54.1], [-2.9, 54.07], [-3.0, 53.45], [-3.85, 53.33], [-4.6, 53.4],
  [-4.75, 52.8], [-4.08, 52.4], [-5.3, 51.9], [-5.05, 51.7], [-4.0, 51.57], [-3.16, 51.45], [-2.7, 51.5],
  [-3.5, 51.2], [-4.53, 51.02], [-4.95, 50.55],
];
const GALWAY: [number, number] = [-9.05, 53.27];
const LONDON: [number, number] = [-0.13, 51.51];

const LON0 = -4.6;
const LAT0 = 54.2;
const K_LAT = Math.cos((LAT0 * Math.PI) / 180);
const proj = ([lon, lat]: [number, number]): [number, number] => [((lon - LON0) * K_LAT) / 4.2, (lat - LAT0) / 4.2];

function inside(poly: [number, number][], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Ireland and Britain as a dot-matrix map with a glowing Galway → London flight path. */
export function journey(K = 65536): Shape {
  const r = rng(29);
  const out = new Float32Array(K * 4);
  let n = 0;
  const push = (x: number, y: number, z: number, w: number) => {
    if (n >= K) return;
    out[n * 4] = x;
    out[n * 4 + 1] = y;
    out[n * 4 + 2] = z;
    out[n * 4 + 3] = w;
    n++;
  };
  const ire = IRELAND.map(proj);
  const gb = BRITAIN.map(proj);
  const dots: [number, number][] = [];
  const step = 0.021;
  for (let y = -1.1; y < 1.2; y += step) {
    for (let x = -1.3; x < 1.3; x += step) {
      const row = Math.round(y / step);
      const xx = x + (row % 2 ? step / 2 : 0);
      if (inside(ire, xx, y) || inside(gb, xx, y)) dots.push([xx, y]);
    }
  }
  const mapShare = Math.floor(K * 0.62);
  for (let i = 0; i < mapShare; i++) {
    const d = dots[i % dots.length]!;
    push(d[0], d[1], 0, 0.32);
  }
  const [gx, gy] = proj(GALWAY);
  const [lx, ly] = proj(LONDON);
  const cityShare = Math.floor(K * 0.08);
  for (let i = 0; i < cityShare; i++) {
    const [cx, cy] = i % 2 ? [gx, gy] : [lx, ly];
    const a = r() * Math.PI * 2;
    const rad = Math.pow(r(), 2) * 0.05;
    push(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, (r() - 0.5) * 0.02, 1);
  }
  // the flight path: a lifted arc, brightest in the middle
  while (n < K) {
    const t = r();
    const x = gx + (lx - gx) * t;
    const y = gy + (ly - gy) * t + Math.sin(Math.PI * t) * 0.16;
    const z = Math.sin(Math.PI * t) * 0.35;
    push(x + (r() - 0.5) * 0.006, y + (r() - 0.5) * 0.006, z, 0.92);
  }
  return { name: 'journey', points: out, count: K, jitter: 0.0035 };
}

/** The capability graph: you → orchestrator → specialist agents → tools and data. */
export function agentGraph(K = 65536): Shape {
  const nodes: GraphNode[] = [
    { id: 'you', x: -1.35, y: 0, size: 0.8 },
    { id: 'orch', x: -0.55, y: 0, size: 1.6, hot: true },
    { id: 'a1', x: 0.25, y: 0.72, size: 1 },
    { id: 'a2', x: 0.35, y: 0.24, size: 1 },
    { id: 'a3', x: 0.35, y: -0.24, size: 1 },
    { id: 'a4', x: 0.25, y: -0.72, size: 1 },
    { id: 't1', x: 1.2, y: 0.9, size: 0.6 },
    { id: 't2', x: 1.32, y: 0.48, size: 0.6 },
    { id: 't3', x: 1.38, y: 0.06, size: 0.6 },
    { id: 't4', x: 1.32, y: -0.36, size: 0.6 },
    { id: 't5', x: 1.2, y: -0.78, size: 0.6 },
    { id: 'gov', x: -0.55, y: -0.85, size: 0.7 },
  ];
  const edges: GraphEdge[] = [
    ['you', 'orch'], ['orch', 'a1'], ['orch', 'a2'], ['orch', 'a3'], ['orch', 'a4'], ['orch', 'gov'],
    ['a1', 't1'], ['a1', 't2'], ['a2', 't2'], ['a2', 't3'], ['a3', 't3'], ['a3', 't4'], ['a4', 't4'], ['a4', 't5'],
  ];
  return graph(nodes, edges, K, 'graph', 5);
}

/** One cluster per published project, strung on a gentle arc around a central lab. */
export function constellation(count: number, K = 65536): Shape {
  const nodes: GraphNode[] = [{ id: 'lab', x: 0, y: -0.35, size: 1.4, hot: true }];
  const edges: GraphEdge[] = [];
  for (let i = 0; i < count; i++) {
    const a = Math.PI * (0.15 + (0.7 * i) / Math.max(1, count - 1));
    nodes.push({ id: `p${i}`, x: Math.cos(a) * -1.15, y: Math.sin(a) * 0.95 - 0.35, size: 0.95, hot: i % 2 === 0 });
    edges.push(['lab', `p${i}`]);
    if (i > 0) edges.push([`p${i - 1}`, `p${i}`]);
  }
  return graph(nodes, edges, K, 'constellation', 41);
}

export function buildShapes(opts: { K: number; projects: number }) {
  const { K } = opts;
  const serif = '"Instrument Serif", Georgia, serif';
  return {
    drift: () => drift(Math.min(K, 32768)),
    orbits: () => orbits(K),
    fields: () => fields(K),
    graph: () => agentGraph(K),
    constellation: () => constellation(opts.projects, K),
    journey: () => journey(K),
    badges: () => badges(5, K),
    banjo: () => banjo(K),
    globe: () => globe(K),
    // "Sláinte": the Irish toast, and the swarm's sign-off.
    signoff: () => text(['sl\u00e1inte'], `italic 400 200px ${serif}`, Math.min(K, 49152), 'signoff', 3),
  } satisfies Record<string, () => Shape>;
}

export type SceneName = keyof ReturnType<typeof buildShapes>;
