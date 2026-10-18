import type { FrameUniforms, Renderer, Shape } from './types';
import { COMPOSITE_FS, DOWN_FS, POINTS_FS, POINTS_VS, QUAD_VS, SIM_FS, UP_FS } from './shaders-glsl';

const BLOOM_LEVELS = 5;

type FBO = { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number };
type Program = { prog: WebGLProgram; loc: (name: string) => WebGLUniformLocation | null };

/** CPU-emulated GL (SwiftShader, llvmpipe, WARP): the swarm would run as a slideshow and heat the CPU. */
export const SOFTWARE_GPU = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/** Why the last createWebGL2 call declined, for the boot log. */
export let declined = '';

export function createWebGL2(canvas: HTMLCanvasElement, particles: number, opts: { allowSoftware?: boolean } = {}): Renderer | null {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', premultipliedAlpha: false });
  if (!gl) return null;
  if (!gl.getExtension('EXT_color_buffer_float')) return null;
  const linearFloat = !!gl.getExtension('OES_texture_float_linear');
  gl.getExtension('EXT_float_blend');
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpuName = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  if (!opts.allowSoftware && SOFTWARE_GPU.test(gpuName)) {
    declined = `software renderer (${SOFTWARE_GPU.exec(gpuName)?.[0] ?? 'CPU'})`;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return null;
  }

  const texSize = Math.ceil(Math.sqrt(particles));
  const N = Math.min(particles, texSize * texSize);

  // ---- helpers ----
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader compile failed');
    return sh;
  };
  const program = (vs: string, fs: string): Program => {
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link failed');
    const cache = new Map<string, WebGLUniformLocation | null>();
    return {
      prog,
      loc: (n) => {
        if (!cache.has(n)) cache.set(n, gl.getUniformLocation(prog, n));
        return cache.get(n)!;
      },
    };
  };
  const floatTex = (w: number, h: number, data: Float32Array | null, filter: number) => {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  };
  const hdrTarget = (w: number, h: number): FBO => {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fb, tex, w, h };
  };

  let sim: Program, points: Program, down: Program, up: Program, composite: Program;
  try {
    sim = program(QUAD_VS, SIM_FS);
    points = program(POINTS_VS, POINTS_FS);
    down = program(QUAD_VS, DOWN_FS);
    up = program(QUAD_VS, UP_FS);
    composite = program(QUAD_VS, COMPOSITE_FS);
  } catch (e) {
    console.warn('[swarm] WebGL2 shader error', e);
    return null;
  }

  // ---- particle state: ping-pong MRT (pos, vel) ----
  const initPos = new Float32Array(texSize * texSize * 4);
  for (let i = 0; i < texSize * texSize; i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const r = 2.2 + Math.random() * 2.2;
    const s = Math.sqrt(1 - u * u);
    initPos[i * 4] = r * s * Math.cos(th);
    initPos[i * 4 + 1] = r * s * Math.sin(th) * 0.6;
    initPos[i * 4 + 2] = r * u - 1.5;
    initPos[i * 4 + 3] = Math.random();
  }
  const state = [0, 1].map(() => {
    const pos = floatTex(texSize, texSize, initPos, gl.NEAREST);
    const vel = floatTex(texSize, texSize, new Float32Array(texSize * texSize * 4), gl.NEAREST);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pos, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, vel, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    return { pos, vel, fb };
  });
  let cur = 0;

  // ---- shapes as float textures ----
  type ShapeTex = { tex: WebGLTexture; w: number; count: number };
  const shapeCache = new Map<string, ShapeTex>();
  const shapeTex = (s: Shape): ShapeTex => {
    let e = shapeCache.get(s.name);
    if (!e) {
      const w = Math.min(2048, Math.ceil(Math.sqrt(s.count)));
      const h = Math.ceil(s.count / w);
      const data = new Float32Array(w * h * 4);
      data.set(s.points.subarray(0, s.count * 4));
      e = { tex: floatTex(w, h, data, gl.NEAREST), w, count: s.count };
      shapeCache.set(s.name, e);
    }
    return e;
  };
  let A: ShapeTex | null = null;
  let B: ShapeTex | null = null;
  let jitterA = 0;
  let jitterB = 0;

  const vao = gl.createVertexArray();
  let width = 2;
  let height = 2;
  let scene: FBO | null = null;
  let levels: FBO[] = [];

  const buildTargets = () => {
    const del = (f: FBO) => {
      gl.deleteFramebuffer(f.fb);
      gl.deleteTexture(f.tex);
    };
    if (scene) del(scene);
    levels.forEach(del);
    scene = hdrTarget(width, height);
    levels = [];
    let w = Math.max(1, width >> 1);
    let h = Math.max(1, height >> 1);
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      levels.push(hdrTarget(w, h));
      w = Math.max(1, w >> 1);
      h = Math.max(1, h >> 1);
    }
  };

  const bindTex = (unit: number, tex: WebGLTexture, loc: WebGLUniformLocation | null) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  };
  const fullscreen = () => gl.drawArrays(gl.TRIANGLES, 0, 3);
  const peerData = new Float32Array(64);
  let active = N;
  void linearFloat;

  (globalThis as any).__glDebug = () => {
    const st = state[cur]!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, st.fb);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    const px = new Float32Array(4 * 4);
    gl.readPixels(0, 0, 4, 1, gl.RGBA, gl.FLOAT, px);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    const vx = new Float32Array(4 * 4);
    gl.readPixels(0, 0, 4, 1, gl.RGBA, gl.FLOAT, vx);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    return { pos: Array.from(px).map((v) => +v.toFixed(3)), vel: Array.from(vx).map((v) => +v.toFixed(3)), A: A && { count: A.count, w: A.w }, B: B && { count: B.count, w: B.w } };
  };
  return {
    backend: 'webgl2',
    gpuName,
    particles: N,
    setShapes(a: Shape, b: Shape) {
      A = shapeTex(a);
      B = shapeTex(b);
      jitterA = a.jitter;
      jitterB = b.jitter;
    },
    setActive(n: number) {
      active = Math.max(1024, Math.min(N, Math.floor(n)));
    },
    resize(w: number, h: number) {
      const nw = Math.max(2, Math.floor(w));
      const nh = Math.max(2, Math.floor(h));
      if (nw === width && nh === height && scene) return;
      width = nw;
      height = nh;
      canvas.width = width;
      canvas.height = height;
      buildTargets();
    },
    frame(u: FrameUniforms, render = true) {
      if (!A || !B || !scene || gl.isContextLost()) return;
      gl.bindVertexArray(vao);
      gl.disable(gl.DEPTH_TEST);

      // 1. simulate
      const src = state[cur]!;
      const dst = state[1 - cur]!;
      gl.useProgram(sim.prog);
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
      const rows = Math.min(texSize, Math.ceil(active / texSize));
      gl.viewport(0, 0, texSize, rows);
      gl.disable(gl.BLEND);
      bindTex(0, src.pos, sim.loc('uPos'));
      bindTex(1, src.vel, sim.loc('uVel'));
      bindTex(2, A.tex, sim.loc('uShapeA'));
      bindTex(3, B.tex, sim.loc('uShapeB'));
      gl.uniform4i(sim.loc('uCounts'), active, A.count, B.count, texSize);
      gl.uniform2i(sim.loc('uShapeW'), A.w, B.w);
      gl.uniform4f(sim.loc('uCam'), u.cam[0], u.cam[1], u.cam[2], u.time);
      gl.uniform4f(sim.loc('uPointer'), u.pointer[0], u.pointer[1], u.pointer[2], u.pointerStrength);
      gl.uniform4f(sim.loc('uMisc'), u.pointerRadius, u.dt, u.audio, Math.min(16, u.peers.length));
      gl.uniform4f(sim.loc('uMorph'), u.morph, u.look.turbulence, u.look.spring, u.look.damping);
      gl.uniform4f(sim.loc('uPlaceA'), u.placeA.x, u.placeA.y, u.placeA.z, u.placeA.scale);
      gl.uniform4f(sim.loc('uPlaceB'), u.placeB.x, u.placeB.y, u.placeB.z, u.placeB.scale);
      gl.uniform4f(sim.loc('uLook'), u.look.size * u.dpr, u.look.brightness, jitterA, jitterB);
      gl.uniform4f(sim.loc('uPulse'), u.pulse[0], u.pulse[1], u.pulse[2], u.pulse[3]);
      gl.uniform4f(sim.loc('uSpin'), u.spin[0], u.spin[1], 0, 0);
      peerData.fill(0);
      u.peers.slice(0, 16).forEach((p, k) => {
        peerData[k * 4] = p.x;
        peerData[k * 4 + 1] = p.y;
        peerData[k * 4 + 3] = p.strength;
      });
      gl.uniform4fv(sim.loc('uPeers[0]'), peerData);
      fullscreen();
      cur = 1 - cur;
      if (!render) return;

      // 2. draw particles additively into the HDR scene
      gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb);
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(points.prog);
      bindTex(0, dst.pos, points.loc('uPos'));
      bindTex(1, dst.vel, points.loc('uVel'));
      gl.uniformMatrix4fv(points.loc('uViewProj'), false, u.viewProj);
      gl.uniform1i(points.loc('uTexSize'), texSize);
      gl.uniform4f(points.loc('uLook'), u.look.size * u.dpr, u.look.brightness, 0, 0);
      gl.uniform4f(points.loc('uRes'), width, height, 1 / width, 1 / height);
      gl.uniform3f(points.loc('uTintA'), ...u.palette.a);
      gl.uniform3f(points.loc('uTintB'), ...u.palette.b);
      gl.drawArrays(gl.POINTS, 0, active);

      // 3. bloom: downsample chain (first pass thresholds), then additive upsample
      gl.disable(gl.BLEND);
      gl.useProgram(down.prog);
      let s: FBO = scene;
      levels.forEach((d, i) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, d.fb);
        gl.viewport(0, 0, d.w, d.h);
        bindTex(0, s.tex, down.loc('uSrc'));
        gl.uniform4f(down.loc('uTexel'), 1 / s.w, 1 / s.h, 0, 0);
        gl.uniform4f(down.loc('uParams'), i === 0 ? 1 : 0, 0.55, 1, 0);
        fullscreen();
        s = d;
      });
      gl.useProgram(up.prog);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = levels.length - 1; i > 0; i--) {
        const from = levels[i]!;
        const to = levels[i - 1]!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, to.fb);
        gl.viewport(0, 0, to.w, to.h);
        bindTex(0, from.tex, up.loc('uSrc'));
        gl.uniform4f(up.loc('uTexel'), 1 / from.w, 1 / from.h, 0, 0);
        gl.uniform4f(up.loc('uParams'), 0, 0, 1, 0);
        fullscreen();
      }
      gl.disable(gl.BLEND);

      // 4. composite to the canvas
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.useProgram(composite.prog);
      bindTex(0, scene.tex, composite.loc('uSrc'));
      bindTex(1, levels[0]!.tex, composite.loc('uBloom'));
      gl.uniform4f(composite.loc('uParams'), u.look.bloom, 1.0, 0, 0.0035);
      gl.uniform4f(composite.loc('uBg'), u.palette.bg[0], u.palette.bg[1], u.palette.bg[2], 1);
      gl.uniform4f(composite.loc('uExtra'), u.time % 100, width, height, 0);
      fullscreen();
    },
    dispose() {
      const lose = gl.getExtension('WEBGL_lose_context');
      lose?.loseContext();
    },
  };
}
