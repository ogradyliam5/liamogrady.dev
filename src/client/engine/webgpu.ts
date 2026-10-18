/// <reference types="@webgpu/types" />
import type { FrameUniforms, Renderer, Shape } from './types';
import { COMPUTE_WGSL, POST_WGSL, RENDER_WGSL } from './shaders-wgsl';

const HDR: GPUTextureFormat = 'rgba16float';
const BLOOM_LEVELS = 5;

type Level = { tex: GPUTexture; view: GPUTextureView; w: number; h: number };

export async function createWebGPU(canvas: HTMLCanvasElement, particles: number, opts: { readback?: boolean; allowSoftware?: boolean } = {}): Promise<Renderer | null> {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu) return null;
  // Some platforms take seconds to report "no adapter"; don't make visitors wait for that.
  const adapter = await Promise.race([
    gpu.requestAdapter({ powerPreference: 'high-performance' }),
    new Promise<null>((r) => setTimeout(() => r(null), 2500)),
  ]);
  if (!adapter) return null;
  // Software adapters are slower than WebGL2 on the same machine, except in headless testing.
  const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info;
  const fallback = !!((info as (GPUAdapterInfo & { isFallbackAdapter?: boolean }) | undefined)?.isFallbackAdapter || (adapter as GPUAdapter & { isFallbackAdapter?: boolean }).isFallbackAdapter);
  if (fallback && !opts.readback && !opts.allowSoftware) return null;
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, 256 * 1024 * 1024),
      maxBufferSize: Math.min(adapter.limits.maxBufferSize, 256 * 1024 * 1024),
    },
  });
  // Headless test mode: render off-screen and copy pixels into a 2D canvas (presentation is unavailable there).
  const readback = !!opts.readback;
  const ctx = readback ? null : canvas.getContext('webgpu');
  if (!readback && !ctx) return null;
  const ctx2d = readback ? canvas.getContext('2d') : null;
  canvas.setAttribute('data-ctx', readback ? '2d' : 'webgpu');
  const format: GPUTextureFormat = readback ? 'rgba8unorm' : gpu.getPreferredCanvasFormat();
  ctx?.configure({ device, format, alphaMode: 'opaque' });
  let offscreen: GPUTexture | null = null;
  let readBuf: GPUBuffer | null = null;
  let readPending = false;

  const gpuName = [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(' ') || 'WebGPU adapter';
  let lost = false;
  device.lost.then((info) => {
    lost = true;
    console.warn('[swarm] WebGPU device lost:', info.reason, info.message);
  });
  let errors = 0;
  device.addEventListener('uncapturederror', (e) => {
    if (errors++ < 5) console.error('[swarm] WebGPU error:', (e as GPUUncapturedErrorEvent).error.message);
  });

  // ---- particle state ----
  const N = particles;
  const init = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    // start as a wide, faint nebula so the first formation "condenses"
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const r = 2.2 + Math.random() * 2.2;
    const s = Math.sqrt(1 - u * u);
    init[i * 4] = r * s * Math.cos(th);
    init[i * 4 + 1] = r * s * Math.sin(th) * 0.6;
    init[i * 4 + 2] = r * u - 1.5;
    init[i * 4 + 3] = Math.random();
  }
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const posBuf = device.createBuffer({ size: N * 16, usage, mappedAtCreation: true });
  new Float32Array(posBuf.getMappedRange()).set(init);
  posBuf.unmap();
  const velBuf = device.createBuffer({ size: N * 16, usage });

  let shapeA: GPUBuffer | null = null;
  let shapeB: GPUBuffer | null = null;
  let countA = 1;
  let countB = 1;
  let jitterA = 0;
  let jitterB = 0;
  const shapeCache = new Map<string, { buf: GPUBuffer; count: number }>();
  const shapeBuffer = (s: Shape) => {
    let entry = shapeCache.get(s.name);
    if (!entry) {
      const buf = device.createBuffer({ size: Math.max(16, s.count * 16), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(buf, 0, s.points.buffer, s.points.byteOffset, s.count * 16);
      entry = { buf, count: s.count };
      shapeCache.set(s.name, entry);
    }
    return entry;
  };

  const params = device.createBuffer({ size: 528, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const paramData = new ArrayBuffer(528);
  const pf = new Float32Array(paramData);
  const pu = new Uint32Array(paramData);

  // ---- pipelines ----
  const computeModule = device.createShaderModule({ code: COMPUTE_WGSL, label: 'swarm-compute' });
  const renderModule = device.createShaderModule({ code: RENDER_WGSL, label: 'swarm-render' });
  const postModule = device.createShaderModule({ code: POST_WGSL, label: 'post' });

  const [computePipeline, renderPipeline, downPipeline, upPipeline, compositePipeline] = await Promise.all([
    device.createComputePipelineAsync({ layout: 'auto', compute: { module: computeModule, entryPoint: 'main' } }),
    device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module: renderModule, entryPoint: 'vs' },
      fragment: {
        module: renderModule,
        entryPoint: 'fs',
        targets: [{ format: HDR, blend: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } } }],
      },
      primitive: { topology: 'triangle-list' },
    }),
    postPipeline('down', HDR, false),
    postPipeline('up', HDR, true),
    postPipeline('composite', format, false),
  ]);

  function postPipeline(entry: string, fmt: GPUTextureFormat, additive: boolean) {
    return device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module: postModule, entryPoint: 'vs' },
      fragment: {
        module: postModule,
        entryPoint: entry,
        targets: [
          additive
            ? { format: fmt, blend: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } } }
            : { format: fmt },
        ],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });

  let computeBG: GPUBindGroup | null = null;
  const renderBG = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: params } },
      { binding: 1, resource: { buffer: posBuf } },
      { binding: 2, resource: { buffer: velBuf } },
    ],
  });

  const rebuildCompute = () => {
    if (!shapeA || !shapeB) return;
    computeBG = device.createBindGroup({
      layout: computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: posBuf } },
        { binding: 2, resource: { buffer: velBuf } },
        { binding: 3, resource: { buffer: shapeA } },
        { binding: 4, resource: { buffer: shapeB } },
      ],
    });
  };

  // ---- render targets (rebuilt on resize) ----
  let width = 1;
  let height = 1;
  let scene: Level | null = null;
  let levels: Level[] = [];
  type PostPass = { pipeline: GPURenderPipeline; bg: GPUBindGroup; target: GPUTextureView; load: GPULoadOp; ubuf: GPUBuffer };
  let passes: PostPass[] = [];
  let compositeU: GPUBuffer | null = null;
  let compositeBGs: GPUBindGroup | null = null;

  const makeLevel = (w: number, h: number, fmt: GPUTextureFormat = HDR): Level => {
    const tex = device.createTexture({ size: [w, h], format: fmt, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    return { tex, view: tex.createView(), w, h };
  };

  const postUniform = (texelW: number, texelH: number, p: [number, number, number, number], bg: number[] = [0, 0, 0, 1], extra: number[] = [0, 0, 0, 0]) => {
    const buf = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buf, 0, new Float32Array([texelW, texelH, 0, 0, ...p, ...bg, ...extra]));
    return buf;
  };

  const buildTargets = () => {
    scene?.tex.destroy();
    for (const l of levels) l.tex.destroy();
    for (const p of passes) p.ubuf.destroy();
    compositeU?.destroy();
    scene = makeLevel(width, height);
    levels = [];
    let w = Math.max(1, width >> 1);
    let h = Math.max(1, height >> 1);
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      levels.push(makeLevel(w, h));
      w = Math.max(1, w >> 1);
      h = Math.max(1, h >> 1);
    }
    passes = [];
    // downsample chain: scene -> L0 (thresholded) -> L1 ... -> L4
    let src: Level = scene;
    levels.forEach((dst, i) => {
      const ubuf = postUniform(1 / src.w, 1 / src.h, [i === 0 ? 1 : 0, 0.55, 1, 0]);
      const bg = device.createBindGroup({
        layout: downPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: ubuf } },
          { binding: 1, resource: sampler },
          { binding: 2, resource: src.view },
        ],
      });
      passes.push({ pipeline: downPipeline, bg, target: dst.view, load: 'clear', ubuf });
      src = dst;
    });
    // upsample chain: L4 -> L3 (+=) ... -> L0
    for (let i = levels.length - 1; i > 0; i--) {
      const s = levels[i]!;
      const d = levels[i - 1]!;
      const ubuf = postUniform(1 / s.w, 1 / s.h, [0, 0, 1, 0]);
      const bg = device.createBindGroup({
        layout: upPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: ubuf } },
          { binding: 1, resource: sampler },
          { binding: 2, resource: s.view },
        ],
      });
      passes.push({ pipeline: upPipeline, bg, target: d.view, load: 'load', ubuf });
    }
    compositeU = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    compositeBGs = device.createBindGroup({
      layout: compositePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: compositeU } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: scene.view },
        { binding: 3, resource: levels[0]!.view },
      ],
    });
  };

  const compositeData = new Float32Array(16);
  let frameNo = 0;
  let active = N;

  const renderer: Renderer = {
    backend: 'webgpu',
    gpuName,
    particles: N,
    setShapes(a: Shape, b: Shape) {
      const ea = shapeBuffer(a);
      const eb = shapeBuffer(b);
      shapeA = ea.buf;
      shapeB = eb.buf;
      countA = ea.count;
      countB = eb.count;
      jitterA = a.jitter;
      jitterB = b.jitter;
      rebuildCompute();
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
      if (lost || !computeBG || !scene || !compositeU || !compositeBGs) return;
      frameNo++;
      // ---- pack params (offsets in floats; see PARAMS_WGSL) ----
      pf.set(u.viewProj, 0);
      pf[16] = u.cam[0]; pf[17] = u.cam[1]; pf[18] = u.cam[2]; pf[19] = u.time;
      pf[20] = u.pointer[0]; pf[21] = u.pointer[1]; pf[22] = u.pointer[2]; pf[23] = u.pointerStrength;
      pf[24] = u.pointerRadius; pf[25] = u.dt; pf[26] = u.audio; pf[27] = Math.min(16, u.peers.length);
      pf[28] = u.morph; pf[29] = u.look.turbulence; pf[30] = u.look.spring; pf[31] = u.look.damping;
      pf[32] = u.placeA.x; pf[33] = u.placeA.y; pf[34] = u.placeA.z; pf[35] = u.placeA.scale;
      pf[36] = u.placeB.x; pf[37] = u.placeB.y; pf[38] = u.placeB.z; pf[39] = u.placeB.scale;
      pf[40] = u.look.size * u.dpr; pf[41] = u.look.brightness; pf[42] = jitterA; pf[43] = jitterB;
      pf[44] = width; pf[45] = height; pf[46] = 1 / width; pf[47] = 1 / height;
      pf[48] = u.pulse[0]; pf[49] = u.pulse[1]; pf[50] = u.pulse[2]; pf[51] = u.pulse[3];
      pf[52] = u.palette.a[0]; pf[53] = u.palette.a[1]; pf[54] = u.palette.a[2]; pf[55] = 1;
      pf[56] = u.palette.b[0]; pf[57] = u.palette.b[1]; pf[58] = u.palette.b[2]; pf[59] = 1;
      pu[60] = active; pu[61] = countA; pu[62] = countB; pu[63] = frameNo;
      pf[64] = u.spin[0]; pf[65] = u.spin[1]; pf[66] = 0; pf[67] = 0;
      for (let k = 0; k < 16; k++) {
        const p = u.peers[k];
        pf[68 + k * 4] = p ? p.x : 0;
        pf[69 + k * 4] = p ? p.y : 0;
        pf[70 + k * 4] = 0;
        pf[71 + k * 4] = p ? p.strength : 0;
      }
      device.queue.writeBuffer(params, 0, paramData);
      compositeData.set([0, 0, 0, 0, u.look.bloom, 1.0, 0, 0.0035, u.palette.bg[0], u.palette.bg[1], u.palette.bg[2], 1, u.time % 100, width, height, 0]);
      device.queue.writeBuffer(compositeU, 0, compositeData);

      const enc = device.createCommandEncoder();
      const cp = enc.beginComputePass();
      cp.setPipeline(computePipeline);
      cp.setBindGroup(0, computeBG);
      cp.dispatchWorkgroups(Math.ceil(active / 256));
      cp.end();
      if (!render) {
        device.queue.submit([enc.finish()]);
        return;
      }

      const rp = enc.beginRenderPass({
        colorAttachments: [{ view: scene.view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      });
      rp.setPipeline(renderPipeline);
      rp.setBindGroup(0, renderBG);
      rp.draw(6, active);
      rp.end();

      for (const pass of passes) {
        const p = enc.beginRenderPass({
          colorAttachments: [{ view: pass.target, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: pass.load, storeOp: 'store' }],
        });
        p.setPipeline(pass.pipeline);
        p.setBindGroup(0, pass.bg);
        p.draw(3);
        p.end();
      }

      let targetView: GPUTextureView;
      if (readback) {
        if (!offscreen || offscreen.width !== width || offscreen.height !== height) {
          offscreen?.destroy();
          readBuf?.destroy();
          offscreen = device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
          readBuf = device.createBuffer({ size: Math.ceil((width * 4) / 256) * 256 * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        }
        targetView = offscreen.createView();
      } else {
        targetView = ctx!.getCurrentTexture().createView();
      }
      const out = enc.beginRenderPass({
        colorAttachments: [{ view: targetView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      });
      out.setPipeline(compositePipeline);
      out.setBindGroup(0, compositeBGs);
      out.draw(3);
      out.end();
      const doRead = readback && !readPending && offscreen && readBuf;
      const bytesPerRow = Math.ceil((width * 4) / 256) * 256;
      if (doRead) enc.copyTextureToBuffer({ texture: offscreen! }, { buffer: readBuf!, bytesPerRow }, [width, height]);
      device.queue.submit([enc.finish()]);
      if (doRead) {
        readPending = true;
        const buf = readBuf!;
        const w = width, h = height;
        buf.mapAsync(GPUMapMode.READ).then(() => {
          const src = new Uint8Array(buf.getMappedRange());
          const img = new ImageData(w, h);
          for (let y = 0; y < h; y++) img.data.set(src.subarray(y * bytesPerRow, y * bytesPerRow + w * 4), y * w * 4);
          buf.unmap();
          ctx2d?.putImageData(img, 0, 0);
          readPending = false;
        }).catch(() => { readPending = false; });
      }
    },
    dispose() {
      for (const { buf } of shapeCache.values()) buf.destroy();
      posBuf.destroy();
      velBuf.destroy();
      params.destroy();
      scene?.tex.destroy();
      for (const l of levels) l.tex.destroy();
      device.destroy();
    },
  };
  return renderer;
}
