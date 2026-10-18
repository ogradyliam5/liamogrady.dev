/**
 * Scene controller: starts the swarm, maps page sections to formations, and
 * keeps the swarm in sync with scroll, pointer, resize and reduced motion.
 */
import { createSwarm, swarmSkipReason, type Swarm } from './engine/index';

export { swarmSkipReason };
import type { Look, Placement } from './engine/types';
import { buildShapes, type SceneName } from './shapes';

const HALF_H = Math.tan((20 * Math.PI) / 180) * 3.2;

const SPIN: Partial<Record<SceneName, number>> = { orbits: 0.11, globe: 0.14, drift: 0.03, fields: 0.015 };

const LOOKS: Record<SceneName, Partial<Look>> = {
  orbits: { brightness: 0.62, size: 1.1, turbulence: 0.22 },
  fields: { brightness: 0.52, size: 1.0, turbulence: 0.12 },
  graph: { brightness: 0.6, size: 1.0, turbulence: 0.18 },
  constellation: { brightness: 0.58, size: 1.0, turbulence: 0.2 },
  journey: { brightness: 0.62, size: 1.05, turbulence: 0.1 },
  badges: { brightness: 0.56, size: 1.0, turbulence: 0.12 },
  drift: { brightness: 0.28, size: 1.0, turbulence: 0.4, spring: 8 },
  banjo: { brightness: 0.64, size: 1.0, turbulence: 0.14 },
  globe: { brightness: 0.5, size: 1.0, turbulence: 0.16 },
  signoff: { brightness: 0.6, size: 1.0, turbulence: 0.1 },
};

function placement(kind: string, scene: SceneName): { place: Placement; dim: number } {
  const aspect = innerWidth / Math.max(1, innerHeight);
  const halfW = HALF_H * aspect;
  const wide = aspect > 1.15 && innerWidth > 960;
  if (!wide) {
    // Phones and portrait tablets: the hero sits above the headline; elsewhere a dim backdrop.
    if (kind === 'hero') return { place: { x: halfW * 0.18, y: HALF_H * 0.6, z: 0, scale: Math.min(0.46, halfW * 0.5) }, dim: 0.8 };
    return { place: { x: 0, y: 0, z: -0.3, scale: Math.min(0.7, halfW * 0.8) }, dim: 0.4 };
  }
  const big = scene === 'journey' ? 1.05 : 1;
  // Formations whose footprint needs its own framing so they never sit under the copy.
  switch (scene) {
    case 'fields':
      return { place: { x: halfW * 0.6, y: -HALF_H * 0.02, z: 0, scale: Math.min(HALF_H * 0.7, halfW * 0.42) }, dim: 0.95 };
    case 'graph':
      return { place: { x: halfW * 0.5, y: HALF_H * 0.2, z: 0, scale: Math.min(HALF_H * 0.57, halfW * 0.35) }, dim: 1 };
    case 'banjo':
      return { place: { x: halfW * 0.3, y: HALF_H * 0.37, z: 0, scale: Math.min(HALF_H * 0.64, halfW * 0.4) }, dim: 1 };
    case 'signoff':
      return { place: { x: halfW * 0.16, y: HALF_H * 0.56, z: -0.5, scale: Math.min(halfW * 0.72, 1.35) }, dim: 0.78 };
  }
  switch (kind) {
    case 'hero':
      return { place: { x: halfW * 0.5, y: 0.1, z: 0, scale: Math.min(1.05, HALF_H * 0.82) * big }, dim: 1 };
    case 'right-wide':
      return { place: { x: halfW * 0.42, y: 0, z: 0, scale: HALF_H * 0.82 * big }, dim: 0.9 };
    case 'top':
      return { place: { x: halfW * 0.25, y: HALF_H * 0.45, z: -0.2, scale: HALF_H * 0.75 }, dim: 0.85 };
    case 'center':
      return { place: { x: 0, y: 0, z: -0.3, scale: 1.1 }, dim: 0.8 };
    case 'watermark':
      return { place: { x: halfW * 0.12, y: HALF_H * 0.38, z: -0.6, scale: Math.min(halfW * 0.95, 1.7) }, dim: 0.45 };
    default:
      return { place: { x: halfW * 0.52, y: 0, z: 0, scale: HALF_H * 0.78 * big }, dim: 1 };
  }
}

export type SceneController = {
  swarm: Swarm;
  go(name: SceneName, kind?: string): void;
  current(): SceneName;
};

export async function startScenes(opts: { reducedMotion: boolean; projects: number; onStats?: (s: unknown) => void }): Promise<SceneController | null> {
  const canvas = document.getElementById('swarm') as HTMLCanvasElement | null;
  if (!canvas) return null;
  const small = innerWidth < 760 || (navigator as Navigator & { deviceMemory?: number }).deviceMemory! <= 4;
  const K = small ? 32768 : 65536;
  const shapes = buildShapes({ K, projects: opts.projects });
  // Fonts must be ready before text formations are sampled.
  try {
    await document.fonts.load('italic 200px "Instrument Serif"');
  } catch {
    /* fall back to Georgia */
  }
  const swarm = await createSwarm({
    canvas,
    shapes,
    reducedMotion: opts.reducedMotion,
    budget: small ? { webgpu: 1 << 18, webgl2: 1 << 16 } : { webgpu: 1 << 20, webgl2: 1 << 18 },
    // ?swarm=software runs it on CPU-emulated GPUs too (headless testing).
    allowSoftware: new URLSearchParams(location.search).get('swarm') === 'software',
  });
  if (!swarm) return null;

  let active: SceneName = 'orbits';
  let activeKind = 'hero';
  const go = (name: SceneName, kind = activeKind) => {
    active = name;
    activeKind = kind;
    // Text formations need width; on narrow screens the sign-off becomes a calm drift.
    if (name === 'signoff' && innerWidth < 960) name = 'drift';
    const { place, dim } = placement(kind, name);
    place.spin = opts.reducedMotion ? 0 : SPIN[name] ?? 0;
    const look = { ...LOOKS[name] };
    look.brightness = (look.brightness ?? 0.55) * dim;
    swarm.scene(name, { place, look });
    if (opts.reducedMotion) swarm.settle(2.2);
  };

  // Start already formed as the orchestrator, then let it breathe.
  go('orbits', 'hero');
  swarm.settle(opts.reducedMotion ? 3 : 0.4);
  if (!opts.reducedMotion) swarm.start();
  (document.querySelector('.stage') as HTMLElement | null)?.classList.add('is-live');
  // Glass and text halos only matter (and are only cheap) with a live GPU canvas behind them.
  document.documentElement.classList.add('gpu-live');

  // Section → formation, triggered when a section crosses the middle of the viewport.
  const sections = [...document.querySelectorAll<HTMLElement>('[data-scene]')];
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target as HTMLElement;
        const name = el.dataset.scene as SceneName;
        if (name && name !== active) go(name, el.dataset.place ?? 'right');
      }
    },
    { rootMargin: '-48% 0px -48% 0px' },
  );
  sections.forEach((s) => io.observe(s));

  if (!opts.reducedMotion) {
    let lastMove = 0;
    addEventListener(
      'pointermove',
      (e) => {
        const now = performance.now();
        if (now - lastMove < 12) return;
        lastMove = now;
        swarm.pointer(e.clientX, e.clientY, e.pointerType === 'mouse' || e.pressure > 0);
      },
      { passive: true },
    );
    document.documentElement.addEventListener('pointerleave', () => swarm.pointer(innerWidth / 2, innerHeight / 2, false));
    addEventListener('pointerdown', (e) => {
      const t = e.target as Element;
      if (t.closest('a, button, input, textarea, select, label, summary, [role="dialog"]')) return;
      swarm.pulse(e.clientX, e.clientY);
    });
  }

  let resizeTimer = 0;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => go(active, activeKind), 180);
  });

  return { swarm, go, current: () => active };
}
