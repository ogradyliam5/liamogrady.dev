/** Public types for the particle engine ("the swarm"). */

export type Backend = 'webgpu' | 'webgl2';

/** A formation is a cloud of K target points (xyz + w tint 0..1) the swarm flows into. */
export type Shape = {
  name: string;
  /** xyzw per point, length = count * 4. Points are normalised to roughly [-1, 1]. */
  points: Float32Array;
  count: number;
  /** Per-particle jitter radius around each target point (world units before scale). */
  jitter: number;
};

export type Placement = { x: number; y: number; z: number; scale: number; /** radians per second about the shape's Y axis */ spin?: number };

export type Look = {
  /** Point sprite radius in CSS pixels. */
  size: number;
  brightness: number;
  /** 0 = calm, 1 = stormy curl-noise flow. */
  turbulence: number;
  /** Spring stiffness towards the target shape. */
  spring: number;
  /** Velocity retention per 1/60 s (0..1). */
  damping: number;
  bloom: number;
};

export type Palette = { a: [number, number, number]; b: [number, number, number]; bg: [number, number, number] };

export type Peer = { x: number; y: number; strength: number };

export type EngineStats = {
  backend: Backend;
  particles: number;
  fps: number;
  frameMs: number;
  gpu: string;
  tier: number;
  dpr: number;
  formation: string;
};

export interface Renderer {
  readonly backend: Backend;
  readonly gpuName: string;
  readonly particles: number;
  setShapes(a: Shape, b: Shape): void;
  /** Simulate and draw only the first `n` particles (adaptive quality). */
  setActive(n: number): void;
  resize(width: number, height: number, dpr: number): void;
  /** Simulate one step; draw unless render === false (used to settle formations instantly). */
  frame(u: FrameUniforms, render?: boolean): void;
  dispose(): void;
}

/** Everything the GPU needs for one frame; written by the engine, read by both backends. */
export type FrameUniforms = {
  viewProj: Float32Array; // 16
  cam: [number, number, number];
  time: number;
  dt: number;
  pointer: [number, number, number];
  pointerStrength: number;
  pointerRadius: number;
  morph: number;
  look: Look;
  placeA: Placement;
  placeB: Placement;
  pulse: [number, number, number, number]; // xyz, age (seconds, <0 = none)
  spin: [number, number]; // current rotation angle of shape A and B
  audio: number;
  palette: Palette;
  peers: Peer[];
  width: number;
  height: number;
  dpr: number;
};
