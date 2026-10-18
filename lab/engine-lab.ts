import { createSwarm } from '../src/client/engine/index';
import { orbits, text, fields, graph, banjo, badges, globe, drift } from '../src/client/engine/formations';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const n = Number(q.get('n') ?? 65536);
const backend = (q.get('backend') ?? undefined) as 'webgpu' | 'webgl2' | undefined;
const shapes = {
  drift: () => drift(32768),
  orbits: () => orbits(65536),
  name: () => text(["Liam O'Grady"], '700 200px Geist, system-ui, sans-serif', 49152, 'name'),
  fields: () => fields(65536),
  graph: () => graph(
    [
      { id: 'user', x: -1.3, y: 0.1, size: 0.9 },
      { id: 'orch', x: -0.45, y: 0.1, size: 1.5, hot: true },
      { id: 'a1', x: 0.4, y: 0.62, size: 1 },
      { id: 'a2', x: 0.5, y: 0.1, size: 1 },
      { id: 'a3', x: 0.4, y: -0.42, size: 1 },
      { id: 't1', x: 1.25, y: 0.75, size: 0.7 },
      { id: 't2', x: 1.32, y: 0.28, size: 0.7 },
      { id: 't3', x: 1.32, y: -0.18, size: 0.7 },
      { id: 't4', x: 1.25, y: -0.62, size: 0.7 },
    ],
    [['user', 'orch'], ['orch', 'a1'], ['orch', 'a2'], ['orch', 'a3'], ['a1', 't1'], ['a1', 't2'], ['a2', 't2'], ['a2', 't3'], ['a3', 't3'], ['a3', 't4']],
  ),
  banjo: () => banjo(65536),
  badges: () => badges(5),
  globe: () => globe(65536),
};
(window as any).__ready = false;
const swarm = await createSwarm({ canvas: canvas, shapes, budget: { webgpu: n, webgl2: n }, forceBackend: backend, readback: q.has('readback'), adaptive: !q.has('noadapt'), allowSoftware: true });
if (!swarm) { document.body.dataset.state = 'none'; (window as any).__ready = true; }
else {
  const shape = q.get('shape') ?? 'orbits';
  const place = { x: Number(q.get('x') ?? 0), y: Number(q.get('y') ?? 0), z: 0, scale: Number(q.get('s') ?? 1) };
  const look: any = {};
  for (const k of ['turbulence','spring','damping','size','brightness','bloom']) if (q.has(k)) look[k] = Number(q.get(k));
  swarm.scene(shape, { place, look });
  if (q.has('settle')) swarm.settle(Number(q.get('settle')));
  if (!q.has('nostart')) swarm.start();
  (window as any).__swarm = swarm;
  (window as any).__step = () => { (swarm as any).__tick?.(); };
  (window as any).__ready = true;
  document.body.dataset.state = swarm.backend;
}
