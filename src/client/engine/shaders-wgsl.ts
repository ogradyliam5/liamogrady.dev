/**
 * WGSL for the WebGPU backend: one compute pass (simulation), one instanced
 * render pass (additive HDR sprites), a bloom chain and an ACES composite.
 */

/** Uniform block shared by compute and render: mat4 + 13 vec4 + 16 peer vec4 = 528 bytes. */
export const PARAMS_WGSL = /* wgsl */ `
struct Params {
  viewProj : mat4x4<f32>,
  cam      : vec4<f32>,   // xyz camera, w time
  pointer  : vec4<f32>,   // xyz world, w strength
  misc     : vec4<f32>,   // x pointer radius, y dt, z audio, w peerCount
  morph    : vec4<f32>,   // x progress, y turbulence, z spring, w damping
  placeA   : vec4<f32>,   // xyz offset, w scale
  placeB   : vec4<f32>,
  look     : vec4<f32>,   // x size px, y brightness, z jitterA, w jitterB
  res      : vec4<f32>,   // width, height, 1/width, 1/height (device px)
  pulse    : vec4<f32>,   // xyz origin, w age (s)
  tintA    : vec4<f32>,
  tintB    : vec4<f32>,
  counts   : vec4<u32>,   // N, KA, KB, frame
  spin     : vec4<f32>,   // x angle A, y angle B (radians, about each shape's Y axis)
  peers    : array<vec4<f32>, 16>,
};
`;

/** Simplex noise with analytic gradient (Gustavson / Ashima, MIT) + bitangent (divergence-free) flow. */
export const NOISE_WGSL = /* wgsl */ `
fn mod289v3(x: vec3<f32>) -> vec3<f32> { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn mod289v4(x: vec4<f32>) -> vec4<f32> { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn permute4(x: vec4<f32>) -> vec4<f32> { return mod289v4(((x * 34.0) + 10.0) * x); }
fn taylorInvSqrt4(r: vec4<f32>) -> vec4<f32> { return 1.79284291400159 - 0.85373472095314 * r; }

// returns vec4(gradient.xyz, value)
fn snoiseGrad(v: vec3<f32>) -> vec4<f32> {
  let C = vec2<f32>(1.0 / 6.0, 1.0 / 3.0);
  let D = vec4<f32>(0.0, 0.5, 1.0, 2.0);
  var i = floor(v + dot(v, C.yyy));
  let x0 = v - i + dot(i, C.xxx);
  let g = step(x0.yzx, x0.xyz);
  let l = 1.0 - g;
  let i1 = min(g.xyz, l.zxy);
  let i2 = max(g.xyz, l.zxy);
  let x1 = x0 - i1 + C.xxx;
  let x2 = x0 - i2 + C.yyy;
  let x3 = x0 - D.yyy;
  i = mod289v3(i);
  let p = permute4(permute4(permute4(
            i.z + vec4<f32>(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4<f32>(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4<f32>(0.0, i1.x, i2.x, 1.0));
  let n_ = 0.142857142857;
  let ns = n_ * D.wyz - D.xzx;
  let j = p - 49.0 * floor(p * ns.z * ns.z);
  let x_ = floor(j * ns.z);
  let y_ = floor(j - 7.0 * x_);
  let x = x_ * ns.x + ns.yyyy;
  let y = y_ * ns.x + ns.yyyy;
  let h = 1.0 - abs(x) - abs(y);
  let b0 = vec4<f32>(x.xy, y.xy);
  let b1 = vec4<f32>(x.zw, y.zw);
  let s0 = floor(b0) * 2.0 + 1.0;
  let s1 = floor(b1) * 2.0 + 1.0;
  let sh = -step(h, vec4<f32>(0.0));
  let a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  let a1 = b1.xzyw + s1.xzyw * sh.zzww;
  var p0 = vec3<f32>(a0.xy, h.x);
  var p1 = vec3<f32>(a0.zw, h.y);
  var p2 = vec3<f32>(a1.xy, h.z);
  var p3 = vec3<f32>(a1.zw, h.w);
  let norm = taylorInvSqrt4(vec4<f32>(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 = p0 * norm.x; p1 = p1 * norm.y; p2 = p2 * norm.z; p3 = p3 * norm.w;
  let m = max(0.5 - vec4<f32>(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), vec4<f32>(0.0));
  let m2 = m * m;
  let m4 = m2 * m2;
  let pdotx = vec4<f32>(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3));
  let temp = m2 * m * pdotx;
  var grad = -8.0 * (temp.x * x0 + temp.y * x1 + temp.z * x2 + temp.w * x3);
  grad = grad + m4.x * p0 + m4.y * p1 + m4.z * p2 + m4.w * p3;
  return vec4<f32>(grad * 105.0, 105.0 * dot(m4, pdotx));
}

fn flow(p: vec3<f32>) -> vec3<f32> {
  let a = snoiseGrad(p).xyz;
  let b = snoiseGrad(p + vec3<f32>(31.341, -43.23, 12.34)).xyz;
  // raw cross products of simplex gradients reach ~50; normalise to roughly unit flow
  let c = cross(a, b) * 0.09;
  let l = length(c);
  return c * min(1.0, 1.6 / max(l, 1e-4));
}

fn rotY(v: vec3<f32>, a: f32) -> vec3<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec3<f32>(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}
fn hashu(n: u32) -> u32 {
  var x = n * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  return (x >> 22u) ^ x;
}
fn hashf(n: u32) -> f32 { return f32(hashu(n)) / 4294967295.0; }
fn randDir(n: u32) -> vec3<f32> {
  let u = hashf(n) * 2.0 - 1.0;
  let th = hashf(n ^ 0x9e3779b9u) * 6.2831853;
  let r = sqrt(max(0.0, 1.0 - u * u));
  return vec3<f32>(r * cos(th), r * sin(th), u);
}
`;

export const COMPUTE_WGSL = /* wgsl */ `
${PARAMS_WGSL}
${NOISE_WGSL}
@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var<storage, read_write> pos : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> vel : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> shapeA : array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> shapeB : array<vec4<f32>>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= P.counts.x) { return; }
  var p = pos[i];
  var v = vel[i];
  let seed = hashf(i * 13u + 7u);
  let t = P.cam.w;
  let dt = P.misc.y;

  // Each particle owns a stable, scattered target in both shapes.
  let ha = hashu(i * 2654435761u + 1u);
  let ia = ha % P.counts.y;
  let ib = hashu(i * 2246822519u + 7u) % P.counts.z;
  let a = shapeA[ia];
  let b = shapeB[ib];
  let jit = randDir(i * 3u + 11u) * pow(hashf(i * 5u + 3u), 0.5);
  let ta = rotY(a.xyz + jit * P.look.z, P.spin.x) * P.placeA.w + P.placeA.xyz;
  let tb = rotY(b.xyz + jit * P.look.w, P.spin.y) * P.placeB.w + P.placeB.xyz;

  // Staggered morph: each particle leaves on its own beat.
  let delay = hashf(i * 9u + 5u) * 0.45;
  let m = smoothstep(0.0, 1.0, clamp((P.morph.x - delay) / 0.55, 0.0, 1.0));
  var tgt = mix(ta, tb, m);
  let arc = sin(m * 3.14159265);
  tgt = tgt + flow(tgt * 0.9 + vec3<f32>(0.0, 0.0, t * 0.07)) * arc * 0.22;

  // Forces: spring to target, divergence-free flow, pointer, peers, pulse.
  var f = (tgt - p.xyz) * P.morph.z;
  let turb = P.morph.y * (0.25 + 0.75 * seed) * (1.0 + P.misc.z * 1.5);
  f = f + flow(p.xyz * 1.35 + vec3<f32>(0.0, t * 0.05, t * 0.11)) * turb;

  let d = p.xyz - P.pointer.xyz;
  let r = max(P.misc.x, 0.001);
  let d2 = dot(d.xy, d.xy);
  f = f + vec3<f32>(normalize(d.xy + vec2<f32>(1e-5)), 0.35) * P.pointer.w * exp(-d2 / (r * r));

  let peerCount = u32(P.misc.w);
  for (var k = 0u; k < 16u; k = k + 1u) {
    if (k >= peerCount) { break; }
    let q = P.peers[k];
    let dq = q.xyz - p.xyz;
    let l2 = dot(dq.xy, dq.xy) + 0.02;
    f = f + vec3<f32>(dq.y, -dq.x, 0.0) * (q.w * 0.06 / l2) * step(l2, 0.12);
  }

  if (P.pulse.w >= 0.0) {
    let dp = p.xyz - P.pulse.xyz;
    let dist = length(dp);
    let front = P.pulse.w * 2.2;
    let ring = exp(-pow((dist - front) * 6.0, 2.0)) * exp(-P.pulse.w * 1.8);
    f = f + normalize(dp + vec3<f32>(1e-5)) * ring * 9.0;
  }

  let keep = pow(P.morph.w, dt * 60.0);
  let nv = (v.xyz + f * dt) * keep;
  let tint = mix(p.w, mix(a.w, b.w, m), min(1.0, dt * 4.0));
  p = vec4<f32>(p.xyz + nv * dt, tint);
  // energy for shading, smoothed
  let e = mix(v.w, clamp(length(nv) * 0.9, 0.0, 4.0), 0.12);
  pos[i] = p;
  vel[i] = vec4<f32>(nv, e);
}
`;

export const RENDER_WGSL = /* wgsl */ `
${PARAMS_WGSL}
fn hashu(n: u32) -> u32 {
  var x = n * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  return (x >> 22u) ^ x;
}
fn hashf(n: u32) -> f32 { return f32(hashu(n)) / 4294967295.0; }
@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var<storage, read> pos : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> vel : array<vec4<f32>>;

struct VSOut {
  @builtin(position) position : vec4<f32>,
  @location(0) uv : vec2<f32>,
  @location(1) color : vec3<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi : u32, @builtin(instance_index) ii : u32) -> VSOut {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0));
  let c = corners[vi];
  let p = pos[ii];
  let v = vel[ii];
  let clip = P.viewProj * vec4<f32>(p.xyz, 1.0);
  let seed = hashf(ii * 13u + 7u);
  let tintW = clamp(p.w, 0.0, 1.0);
  let energy = v.w;
  let sizePx = max(P.look.x * (0.55 + 0.9 * fract(seed * 13.37)) * (1.0 + energy * 0.35), 0.75);
  var out : VSOut;
  out.position = vec4<f32>(clip.xy + c * sizePx * P.res.zw * 2.0 * clip.w, clip.zw);
  out.uv = c;
  let depthFade = clamp(1.6 - clip.w * 0.28, 0.25, 1.4);
  let hot = smoothstep(0.15, 1.6, energy);
  let tint = mix(P.tintA.rgb, P.tintB.rgb, clamp(tintW * 0.85 + (fract(seed * 3.17) - 0.5) * 0.3, 0.0, 1.0));
  let white = vec3<f32>(1.0, 0.96, 0.9);
  out.color = mix(tint, white, hot * 0.5) * P.look.y * depthFade * (0.35 + 0.65 * fract(seed * 7.91)) * (0.55 + tintW * 0.6);
  return out;
}

@fragment
fn fs(in : VSOut) -> @location(0) vec4<f32> {
  let d = dot(in.uv, in.uv);
  if (d > 1.0) { discard; }
  let a = (1.0 - d);
  return vec4<f32>(in.color * a * a, 1.0);
}
`;

/** Fullscreen triangle + post-processing (bloom prefilter/down/up and composite). */
export const POST_WGSL = /* wgsl */ `
struct PostU { texel : vec4<f32>, params : vec4<f32>, bg : vec4<f32>, extra : vec4<f32> };
@group(0) @binding(0) var<uniform> U : PostU;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var src : texture_2d<f32>;
@group(0) @binding(3) var src2 : texture_2d<f32>;

struct FsIn { @builtin(position) position : vec4<f32>, @location(0) uv : vec2<f32> };

@vertex
fn vs(@builtin(vertex_index) vi : u32) -> FsIn {
  var pts = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  let p = pts[vi];
  var o : FsIn;
  o.position = vec4<f32>(p, 0.0, 1.0);
  o.uv = vec2<f32>(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  return o;
}

fn luma(c : vec3<f32>) -> f32 { return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722)); }

// 13-tap downsample (Call of Duty: Advanced Warfare), optional soft threshold on the first pass.
@fragment
fn down(in : FsIn) -> @location(0) vec4<f32> {
  let t = U.texel.xy;
  let uv = in.uv;
  let a = textureSample(src, samp, uv + t * vec2<f32>(-2.0, -2.0)).rgb;
  let b = textureSample(src, samp, uv + t * vec2<f32>(0.0, -2.0)).rgb;
  let c = textureSample(src, samp, uv + t * vec2<f32>(2.0, -2.0)).rgb;
  let d = textureSample(src, samp, uv + t * vec2<f32>(-2.0, 0.0)).rgb;
  let e = textureSample(src, samp, uv).rgb;
  let f = textureSample(src, samp, uv + t * vec2<f32>(2.0, 0.0)).rgb;
  let g = textureSample(src, samp, uv + t * vec2<f32>(-2.0, 2.0)).rgb;
  let h = textureSample(src, samp, uv + t * vec2<f32>(0.0, 2.0)).rgb;
  let i = textureSample(src, samp, uv + t * vec2<f32>(2.0, 2.0)).rgb;
  let j = textureSample(src, samp, uv + t * vec2<f32>(-1.0, -1.0)).rgb;
  let k = textureSample(src, samp, uv + t * vec2<f32>(1.0, -1.0)).rgb;
  let l = textureSample(src, samp, uv + t * vec2<f32>(-1.0, 1.0)).rgb;
  let m = textureSample(src, samp, uv + t * vec2<f32>(1.0, 1.0)).rgb;
  var col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  if (U.params.x > 0.5) {
    let th = U.params.y;
    let br = max(col.r, max(col.g, col.b));
    let soft = clamp(br - th + 0.5, 0.0, 1.0);
    let contrib = max(soft * soft * 0.5, br - th) / max(br, 1e-4);
    col = col * max(contrib, 0.0);
  }
  return vec4<f32>(col, 1.0);
}

// 3x3 tent upsample, blended additively onto the next larger mip.
@fragment
fn up(in : FsIn) -> @location(0) vec4<f32> {
  let t = U.texel.xy * U.params.z;
  let uv = in.uv;
  var s = textureSample(src, samp, uv + vec2<f32>(-t.x, -t.y)).rgb;
  s = s + textureSample(src, samp, uv + vec2<f32>(0.0, -t.y)).rgb * 2.0;
  s = s + textureSample(src, samp, uv + vec2<f32>(t.x, -t.y)).rgb;
  s = s + textureSample(src, samp, uv + vec2<f32>(-t.x, 0.0)).rgb * 2.0;
  s = s + textureSample(src, samp, uv).rgb * 4.0;
  s = s + textureSample(src, samp, uv + vec2<f32>(t.x, 0.0)).rgb * 2.0;
  s = s + textureSample(src, samp, uv + vec2<f32>(-t.x, t.y)).rgb;
  s = s + textureSample(src, samp, uv + vec2<f32>(0.0, t.y)).rgb * 2.0;
  s = s + textureSample(src, samp, uv + vec2<f32>(t.x, t.y)).rgb;
  return vec4<f32>(s / 16.0, 1.0);
}

fn aces(x : vec3<f32>) -> vec3<f32> {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}
fn hash2(p : vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453); }

@fragment
fn composite(in : FsIn) -> @location(0) vec4<f32> {
  let uv = in.uv;
  let center = uv - 0.5;
  let ca = center * U.params.w;
  let scene = vec3<f32>(
    textureSample(src, samp, uv - ca).r,
    textureSample(src, samp, uv).g,
    textureSample(src, samp, uv + ca).b);
  let bloom = textureSample(src2, samp, uv).rgb;
  var col = scene + bloom * U.params.x;
  // atmosphere: faint horizon glow behind everything
  let glow = exp(-pow(length(center * vec2<f32>(1.0, 1.6)) * 2.2, 2.0)) * 0.05;
  col = col + vec3<f32>(0.10, 0.22, 0.32) * glow;
  col = aces(col * U.params.y);
  let vig = smoothstep(0.95, 0.25, length(center * vec2<f32>(1.15, 1.0)));
  col = mix(U.bg.rgb, col + U.bg.rgb, vig * 0.85 + 0.15);
  let grain = (hash2(uv * U.extra.yz + vec2<f32>(U.extra.x, U.extra.x * 1.7)) - 0.5) * 0.022;
  return vec4<f32>(col + grain, 1.0);
}
`;
