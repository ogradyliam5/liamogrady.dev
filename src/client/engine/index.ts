/**
 * The swarm: a GPU particle system that flows between procedural formations.
 * WebGPU compute when available, WebGL2 GPGPU otherwise, nothing at all when
 * the visitor prefers reduced motion or the device can't keep up.
 */
import type { Backend, EngineStats, FrameUniforms, Look, Palette, Peer, Placement, Renderer, Shape } from './types';
import { createWebGPU } from './webgpu';
import { createWebGL2, declined as declinedGLRef } from './webgl2';
import { clamp, damp, lookAt, multiply, perspective } from './math';

export type SceneSpec = {
  shape: string;
  place?: Partial<Placement>;
  look?: Partial<Look>;
};

export type SwarmOptions = {
  canvas: HTMLCanvasElement;
  shapes: Record<string, () => Shape>;
  /** Max particles per backend. */
  budget?: { webgpu: number; webgl2: number };
  palette?: Palette;
  reducedMotion?: boolean;
  forceBackend?: Backend;
  /** Headless testing only: WebGPU renders off-screen and is copied into a 2D canvas. */
  readback?: boolean;
  /** Also run on CPU-emulated GPUs (SwiftShader, llvmpipe). Off by default: visitors get the still poster. */
  allowSoftware?: boolean;
  /** Adaptive particle count (default true). */
  adaptive?: boolean;
  onStats?: (s: EngineStats) => void;
};

export type Swarm = {
  readonly backend: Backend;
  readonly gpuName: string;
  scene(name: string, spec?: Omit<SceneSpec, 'shape'>): void;
  pointer(clientX: number, clientY: number, active: boolean): void;
  pulse(clientX?: number, clientY?: number): void;
  peers(list: Peer[]): void;
  audio(level: number): void;
  energy(level: number): void;
  setPalette(p: Palette): void;
  stats(): EngineStats;
  /** Run the simulation forward without drawing, so the current formation appears already formed. */
  settle(seconds?: number): void;
  /** Test hook: advance exactly one frame. */
  __tick?(): void;
  start(): void;
  stop(): void;
  dispose(): void;
};

const DEFAULT_LOOK: Look = { size: 1.15, brightness: 0.55, turbulence: 0.25, spring: 30, damping: 0.83, bloom: 0.85 };
export const ATLANTIC: Palette = { a: [0.32, 0.78, 1.0], b: [1.0, 0.74, 0.32], bg: [0.012, 0.018, 0.03] };

let skipReason = '';
/** Why the last createSwarm returned null ("" when there was no GPU at all). */
export const swarmSkipReason = () => skipReason;

export async function createSwarm(o: SwarmOptions): Promise<Swarm | null> {
  let canvas = o.canvas;
  const budget = o.budget ?? { webgpu: 1 << 20, webgl2: 1 << 18 };
  let r: Renderer | null = null;
  const t0 = performance.now();
  if (o.forceBackend !== 'webgl2') {
    try {
      r = await createWebGPU(canvas, budget.webgpu, { readback: o.readback, allowSoftware: o.allowSoftware });
    } catch (e) {
      console.warn('[swarm] WebGPU unavailable, falling back', e);
      r = null;
    }
  }
  if (!r && o.forceBackend !== 'webgpu') {
    // A canvas that has handed out a WebGPU context cannot give WebGL2; swap in a fresh one.
    if (canvas.getAttribute('data-ctx') === 'webgpu') {
      const fresh = canvas.cloneNode(false) as HTMLCanvasElement;
      fresh.removeAttribute('data-ctx');
      canvas.replaceWith(fresh);
      canvas = fresh;
    }
    r = createWebGL2(canvas, budget.webgl2, { allowSoftware: o.allowSoftware });
  }
  if (!r) {
    skipReason = declinedGLRef;
    return null;
  }
  const R = r;
  const initMs = performance.now() - t0;

  // ---- state ----
  const shapeCache = new Map<string, Shape>();
  const getShape = (name: string): Shape => {
    let s = shapeCache.get(name);
    if (!s) {
      const make = o.shapes[name] ?? o.shapes['drift'];
      s = make!();
      shapeCache.set(name, s);
    }
    return s;
  };
  let palette = o.palette ?? ATLANTIC;
  let a = getShape(Object.keys(o.shapes)[0]!);
  let b = a;
  let placeA: Placement = { x: 0, y: 0, z: 0, scale: 1 };
  let placeB: Placement = { ...placeA };
  let morph = 1;
  let spinA = 0;
  let spinB = 0;
  const look: Look = { ...DEFAULT_LOOK };
  let lookTarget: Look = { ...DEFAULT_LOOK };
  let currentName = a.name;
  R.setShapes(a, b);

  const ptr = { x: 0, y: 0, wx: 0, wy: 0, active: false, strength: 0, nx: 0, ny: 0 };
  let pulseAge = -1;
  const pulseAt: [number, number, number] = [0, 0, 0];
  let peerList: Peer[] = [];
  let audio = 0;
  let energy = 0;
  let running = false;
  let raf = 0;
  let last = performance.now();
  let time = 0;
  let fps = 60;
  let frameMs = 16;
  let active = R.particles;
  const maxActive = R.particles;
  let tier = R.backend === 'webgpu' ? 3 : 2;
  const cam = { x: 0, y: 0, z: 3.2 };
  const FOV = (40 * Math.PI) / 180;
  const proj = new Float32Array(16);
  const view = new Float32Array(16);
  const viewProj = new Float32Array(16);
  let dpr = 1;
  let cssW = 1;
  let cssH = 1;

  const resize = () => {
    cssW = canvas.clientWidth || window.innerWidth;
    cssH = canvas.clientHeight || window.innerHeight;
    const maxDpr = R.backend === 'webgpu' ? 1.75 : 1.25;
    dpr = Math.min(window.devicePixelRatio || 1, maxDpr) * (tier <= 1 ? 0.75 : 1);
    R.resize(cssW * dpr, cssH * dpr, dpr);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  const toWorld = (clientX: number, clientY: number): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
    const h = Math.tan(FOV / 2) * cam.z;
    return [nx * h * (rect.width / rect.height) + cam.x, ny * h + cam.y];
  };

  // ---- adaptive quality ----
  let windowStart = performance.now();
  let windowFrames = 0;
  let windowMs = 0;
  let calmSince = 0;
  const adapt = (now: number, ms: number) => {
    if (o.adaptive === false) {
      windowFrames++;
      windowMs += ms;
      if (now - windowStart >= 1000) {
        fps = Math.round(1000 / Math.max(1, windowMs / windowFrames));
        windowStart = now;
        windowFrames = 0;
        windowMs = 0;
      }
      return;
    }
    windowFrames++;
    windowMs += ms;
    if (now - windowStart < 1000) return;
    const avg = windowMs / windowFrames;
    fps = Math.round(1000 / Math.max(1, avg));
    windowStart = now;
    windowFrames = 0;
    windowMs = 0;
    if (time < 1.5) return; // let shaders warm up
    if (avg > 21 && active > 16384) {
      active = Math.max(16384, Math.floor(active * 0.7));
      R.setActive(active);
      calmSince = now;
      if (active <= maxActive * 0.25 && tier > 1) {
        tier--;
        resize();
      }
    } else if (avg < 13 && active < maxActive) {
      if (!calmSince) calmSince = now;
      if (now - calmSince > 4000) {
        active = Math.min(maxActive, Math.floor(active * 1.25));
        R.setActive(active);
        calmSince = now;
      }
    } else {
      calmSince = now;
    }
  };

  const uniforms: FrameUniforms = {
    viewProj,
    cam: [0, 0, 0],
    time: 0,
    dt: 0,
    pointer: [0, 0, 0],
    pointerStrength: 0,
    pointerRadius: 0.35,
    morph: 1,
    look,
    placeA,
    placeB,
    pulse: [0, 0, 0, -1],
    spin: [0, 0],
    audio: 0,
    palette,
    peers: [],
    width: 1,
    height: 1,
    dpr: 1,
  };

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    // rAF timestamps can precede the performance.now() taken in start(): never integrate backwards.
    const ms = Math.min(100, Math.max(0, now - last));
    last = Math.max(last, now);
    frameMs = damp(frameMs, ms, 4, ms / 1000);
    adapt(now, ms);
    step(Math.min(1 / 30, ms / 1000), true);
  };

  /** Advance the simulation by dt seconds; draw if render is true. */
  const step = (dt: number, render: boolean) => {
    time += dt;

    // morph progress (ease handled per particle in the shader)
    if (morph < 1) morph = Math.min(1, morph + dt / (o.reducedMotion ? 0.35 : 2.1));
    // look easing
    for (const k of Object.keys(look) as (keyof Look)[]) look[k] = damp(look[k], lookTarget[k], 2.2, dt);

    // pointer influence fades in/out
    ptr.strength = damp(ptr.strength, ptr.active && !o.reducedMotion ? 1 : 0, 6, dt);
    // camera parallax
    const tx = o.reducedMotion ? 0 : ptr.nx * 0.12;
    const ty = o.reducedMotion ? 0 : ptr.ny * 0.08;
    cam.x = damp(cam.x, tx, 1.6, dt);
    cam.y = damp(cam.y, ty, 1.6, dt);
    perspective(FOV, cssW / Math.max(1, cssH), 0.05, 50, proj);
    lookAt([cam.x, cam.y, cam.z], [0, 0, 0], [0, 1, 0], view);
    multiply(proj, view, viewProj);

    if (!o.reducedMotion) {
      spinA += (placeA.spin ?? 0) * dt;
      spinB += (placeB.spin ?? 0) * dt;
    }
    uniforms.spin[0] = spinA;
    uniforms.spin[1] = spinB;
    if (pulseAge >= 0) {
      pulseAge += dt;
      if (pulseAge > 2.5) pulseAge = -1;
    }
    audio = damp(audio, 0, 3, dt);
    energy = damp(energy, 0, 1.2, dt);

    uniforms.cam[0] = cam.x;
    uniforms.cam[1] = cam.y;
    uniforms.cam[2] = cam.z;
    uniforms.time = time;
    uniforms.dt = dt;
    uniforms.pointer[0] = ptr.wx;
    uniforms.pointer[1] = ptr.wy;
    uniforms.pointer[2] = 0;
    uniforms.pointerStrength = ptr.strength * 2.4;
    uniforms.morph = morph;
    uniforms.placeA = placeA;
    uniforms.placeB = placeB;
    uniforms.pulse[0] = pulseAt[0];
    uniforms.pulse[1] = pulseAt[1];
    uniforms.pulse[2] = pulseAt[2];
    uniforms.pulse[3] = pulseAge;
    uniforms.audio = clamp(audio + energy * 0.6, 0, 2);
    uniforms.palette = palette;
    uniforms.peers = peerList;
    uniforms.width = cssW * dpr;
    uniforms.height = cssH * dpr;
    uniforms.dpr = dpr;
    // Keep the overall light level stable whatever the particle count: more particles → finer and dimmer.
    const density = 65536 / Math.max(1024, active);
    const lookFrame: Look = {
      ...look,
      brightness: look.brightness * Math.pow(density, 0.7) * (1 + energy * 0.5),
      size: look.size * Math.pow(density, 0.22),
      turbulence: look.turbulence + energy * 0.6,
    };
    uniforms.look = lookFrame;
    R.frame(uniforms, render);
  };

  const onVis = () => {
    if (document.hidden) cancelAnimationFrame(raf);
    else if (running) {
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };
  document.addEventListener('visibilitychange', onVis);

  const swarm: Swarm = {
    backend: R.backend,
    gpuName: R.gpuName,
    scene(name, spec = {}) {
      const next = getShape(name);
      const nextPlace: Placement = { x: 0, y: 0, z: 0, scale: 1, ...spec.place };
      const nextLook: Look = { ...DEFAULT_LOOK, ...spec.look };
      lookTarget = nextLook;
      if (next === b && morph >= 1) {
        // same shape, maybe a new placement: glide there
        placeA = { ...placeB };
        placeB = nextPlace;
        spinA = spinB;
        a = b;
        morph = 0;
        R.setShapes(a, b);
        currentName = name;
        return;
      }
      if (morph < 0.5) {
        // still mostly the old shape: keep A, retarget B
        b = next;
        placeB = nextPlace;
        spinB = 0;
      } else {
        a = b;
        placeA = { ...placeB };
        spinA = spinB;
        b = next;
        placeB = nextPlace;
        spinB = 0;
        morph = 0;
      }
      currentName = name;
      R.setShapes(a, b);
    },
    pointer(clientX, clientY, isActive) {
      const rect = canvas.getBoundingClientRect();
      ptr.nx = ((clientX - rect.left) / rect.width) * 2 - 1;
      ptr.ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
      [ptr.wx, ptr.wy] = toWorld(clientX, clientY);
      ptr.active = isActive;
    },
    pulse(clientX, clientY) {
      if (o.reducedMotion) return;
      const [x, y] = clientX === undefined ? [0, 0] : toWorld(clientX, clientY ?? 0);
      pulseAt[0] = x;
      pulseAt[1] = y;
      pulseAt[2] = 0;
      pulseAge = 0;
    },
    peers(list) {
      peerList = list.slice(0, 16).map((p) => {
        const [x, y] = toWorld(p.x * cssW, p.y * cssH);
        return { x, y, strength: p.strength };
      });
    },
    audio(level) {
      audio = Math.max(audio, clamp(level, 0, 2));
    },
    energy(level) {
      energy = Math.max(energy, clamp(level, 0, 1));
    },
    setPalette(p) {
      palette = p;
    },
    stats: () => ({
      backend: R.backend,
      particles: active,
      fps,
      frameMs: Math.round(frameMs * 10) / 10,
      gpu: R.gpuName,
      tier,
      dpr: Math.round(dpr * 100) / 100,
      formation: currentName,
      initMs: Math.round(initMs),
    }) as EngineStats,
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    settle(seconds = 3) {
      const steps = Math.round(seconds * 60);
      for (let i = 0; i < steps; i++) step(1 / 60, i === steps - 1);
    },
    __tick() {
      tick(performance.now());
      cancelAnimationFrame(raf);
    },
    dispose() {
      swarm.stop();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      R.dispose();
    },
  };
  return swarm;
}
