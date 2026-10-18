import { createSwarm } from '../src/client/engine/index';
import { orbits } from '../src/client/engine/formations';
const canvas = document.getElementById('c') as HTMLCanvasElement;
(window as any).__ready = false;
await document.fonts.ready;
const swarm = await createSwarm({ canvas, shapes: { drift: () => orbits(65536), orbits: () => orbits(65536) }, budget: { webgpu: 1 << 16, webgl2: 1 << 16 }, forceBackend: 'webgl2', adaptive: false, allowSoftware: true });
if (swarm) {
  swarm.scene('orbits', { place: { x: 1.16, y: 0.02, z: 0, scale: 0.95 }, look: { brightness: 0.5, size: 1.05, turbulence: 0.15 } });
  swarm.settle(2.5);
}
(window as any).__ready = true;
