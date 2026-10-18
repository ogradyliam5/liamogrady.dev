/**
 * GLSL ES 3.00 for the WebGL2 fallback. Same simulation as the WGSL compute pass,
 * done as a fragment-shader GPGPU step over RGBA32F textures (one texel per particle).
 */

export const QUAD_VS = /* glsl */ `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2.0 - 1.0;
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec3 snoiseGrad(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  vec4 m2 = m * m;
  vec4 m4 = m2 * m2;
  vec4 pdotx = vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3));
  vec4 temp = m2 * m * pdotx;
  vec3 grad = -8.0 * (temp.x * x0 + temp.y * x1 + temp.z * x2 + temp.w * x3);
  grad += m4.x * p0 + m4.y * p1 + m4.z * p2 + m4.w * p3;
  return grad * 105.0;
}
vec3 flowField(vec3 p) {
  vec3 c = cross(snoiseGrad(p), snoiseGrad(p + vec3(31.341, -43.23, 12.34))) * 0.09;
  float l = length(c);
  return c * min(1.0, 1.6 / max(l, 1e-4));
}
vec3 rotY(vec3 v, float a) {
  float c = cos(a), s = sin(a);
  return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}
uint hashu(uint n) {
  uint x = n * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  return (x >> 22u) ^ x;
}
float hashf(uint n) { return float(hashu(n)) / 4294967295.0; }
vec3 randDir(uint n) {
  float u = hashf(n) * 2.0 - 1.0;
  float th = hashf(n ^ 0x9e3779b9u) * 6.2831853;
  float r = sqrt(max(0.0, 1.0 - u * u));
  return vec3(r * cos(th), r * sin(th), u);
}
`;

export const SIM_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform sampler2D uPos;
uniform sampler2D uVel;
uniform sampler2D uShapeA;
uniform sampler2D uShapeB;
uniform ivec4 uCounts;     // N, KA, KB, texSize
uniform ivec2 uShapeW;     // widths of shape textures
uniform vec4 uCam;         // xyz, time
uniform vec4 uPointer;     // xyz, strength
uniform vec4 uMisc;        // radius, dt, audio, peerCount
uniform vec4 uMorph;       // progress, turbulence, spring, damping
uniform vec4 uPlaceA;
uniform vec4 uPlaceB;
uniform vec4 uLook;        // size, brightness, jitterA, jitterB
uniform vec4 uPulse;
uniform vec4 uSpin;
uniform vec4 uPeers[16];
layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oVel;
${NOISE_GLSL}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  int idx = c.y * uCounts.w + c.x;
  vec4 p = texelFetch(uPos, c, 0);
  vec4 v = texelFetch(uVel, c, 0);
  if (idx >= uCounts.x) { oPos = p; oVel = v; return; }
  uint i = uint(idx);
  float seed = hashf(i * 13u + 7u);
  float t = uCam.w;
  float dt = uMisc.y;
  uint ia = hashu(i * 2654435761u + 1u) % uint(uCounts.y);
  uint ib = hashu(i * 2246822519u + 7u) % uint(uCounts.z);
  vec4 a = texelFetch(uShapeA, ivec2(int(ia) % uShapeW.x, int(ia) / uShapeW.x), 0);
  vec4 b = texelFetch(uShapeB, ivec2(int(ib) % uShapeW.y, int(ib) / uShapeW.y), 0);
  vec3 jit = randDir(i * 3u + 11u) * pow(hashf(i * 5u + 3u), 0.5);
  vec3 ta = rotY(a.xyz + jit * uLook.z, uSpin.x) * uPlaceA.w + uPlaceA.xyz;
  vec3 tb = rotY(b.xyz + jit * uLook.w, uSpin.y) * uPlaceB.w + uPlaceB.xyz;
  float delay = hashf(i * 9u + 5u) * 0.45;
  float m = smoothstep(0.0, 1.0, clamp((uMorph.x - delay) / 0.55, 0.0, 1.0));
  vec3 tgt = mix(ta, tb, m);
  float arc = sin(m * 3.14159265);
  tgt += flowField(tgt * 0.9 + vec3(0.0, 0.0, t * 0.07)) * arc * 0.22;
  vec3 f = (tgt - p.xyz) * uMorph.z;
  float turb = uMorph.y * (0.25 + 0.75 * seed) * (1.0 + uMisc.z * 1.5);
  f += flowField(p.xyz * 1.35 + vec3(0.0, t * 0.05, t * 0.11)) * turb;
  vec3 d = p.xyz - uPointer.xyz;
  float r = max(uMisc.x, 0.001);
  float d2 = dot(d.xy, d.xy);
  f += vec3(normalize(d.xy + vec2(1e-5)), 0.35) * uPointer.w * exp(-d2 / (r * r));
  int peerCount = int(uMisc.w);
  for (int k = 0; k < 16; k++) {
    if (k >= peerCount) break;
    vec4 q = uPeers[k];
    vec3 dq = q.xyz - p.xyz;
    float l2 = dot(dq.xy, dq.xy) + 0.02;
    f += vec3(dq.y, -dq.x, 0.0) * (q.w * 0.06 / l2) * step(l2, 0.12);
  }
  if (uPulse.w >= 0.0) {
    vec3 dp = p.xyz - uPulse.xyz;
    float dist = length(dp);
    float front = uPulse.w * 2.2;
    float ring = exp(-pow((dist - front) * 6.0, 2.0)) * exp(-uPulse.w * 1.8);
    f += normalize(dp + vec3(1e-5)) * ring * 9.0;
  }
  float keep = pow(uMorph.w, dt * 60.0);
  vec3 nv = (v.xyz + f * dt) * keep;
  float e = mix(v.w, clamp(length(nv) * 0.9, 0.0, 4.0), 0.12);
  float tint = mix(p.w, mix(a.w, b.w, m), min(1.0, dt * 4.0));
  oPos = vec4(p.xyz + nv * dt, tint);
  oVel = vec4(nv, e);
}`;

export const POINTS_VS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uPos;
uniform sampler2D uVel;
uniform mat4 uViewProj;
uniform int uTexSize;
uniform vec4 uLook;   // size, brightness
uniform vec4 uRes;    // w, h, 1/w, 1/h
uniform vec3 uTintA;
uniform vec3 uTintB;
out vec3 vColor;
uint hashu(uint n) {
  uint x = n * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  return (x >> 22u) ^ x;
}
float hashf(uint n) { return float(hashu(n)) / 4294967295.0; }
void main() {
  ivec2 c = ivec2(gl_VertexID % uTexSize, gl_VertexID / uTexSize);
  vec4 p = texelFetch(uPos, c, 0);
  vec4 v = texelFetch(uVel, c, 0);
  vec4 clip = uViewProj * vec4(p.xyz, 1.0);
  float seed = hashf(uint(gl_VertexID) * 13u + 7u);
  float tintW = clamp(p.w, 0.0, 1.0);
  float energy = v.w;
  float sizePx = uLook.x * (0.55 + 0.9 * fract(seed * 13.37)) * (1.0 + energy * 0.35);
  gl_Position = clip;
  gl_PointSize = max(sizePx * 2.0, 1.0);
  float depthFade = clamp(1.6 - clip.w * 0.28, 0.25, 1.4);
  float hot = smoothstep(0.15, 1.6, energy);
  vec3 tint = mix(uTintA, uTintB, clamp(tintW * 0.85 + (fract(seed * 3.17) - 0.5) * 0.3, 0.0, 1.0));
  vColor = mix(tint, vec3(1.0, 0.96, 0.9), hot * 0.5) * uLook.y * depthFade * (0.35 + 0.65 * fract(seed * 7.91)) * (0.55 + tintW * 0.6);
}`;

export const POINTS_FS = /* glsl */ `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 o;
void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float d = dot(uv, uv);
  if (d > 1.0) discard;
  float a = 1.0 - d;
  o = vec4(vColor * a * a, 1.0);
}`;

export const DOWN_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec4 uTexel;   // texel size xy
uniform vec4 uParams;  // x threshold on, y threshold
in vec2 vUv;
out vec4 o;
vec3 s(vec2 off) { return texture(uSrc, vUv + uTexel.xy * off).rgb; }
void main() {
  vec3 col = s(vec2(0.0)) * 0.125
    + (s(vec2(-2.0, -2.0)) + s(vec2(2.0, -2.0)) + s(vec2(-2.0, 2.0)) + s(vec2(2.0, 2.0))) * 0.03125
    + (s(vec2(0.0, -2.0)) + s(vec2(-2.0, 0.0)) + s(vec2(2.0, 0.0)) + s(vec2(0.0, 2.0))) * 0.0625
    + (s(vec2(-1.0, -1.0)) + s(vec2(1.0, -1.0)) + s(vec2(-1.0, 1.0)) + s(vec2(1.0, 1.0))) * 0.125;
  if (uParams.x > 0.5) {
    float br = max(col.r, max(col.g, col.b));
    float soft = clamp(br - uParams.y + 0.5, 0.0, 1.0);
    float contrib = max(soft * soft * 0.5, br - uParams.y) / max(br, 1e-4);
    col *= max(contrib, 0.0);
  }
  o = vec4(col, 1.0);
}`;

export const UP_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec4 uTexel;
uniform vec4 uParams;  // z radius
in vec2 vUv;
out vec4 o;
void main() {
  vec2 t = uTexel.xy * uParams.z;
  vec3 s = texture(uSrc, vUv + vec2(-t.x, -t.y)).rgb;
  s += texture(uSrc, vUv + vec2(0.0, -t.y)).rgb * 2.0;
  s += texture(uSrc, vUv + vec2(t.x, -t.y)).rgb;
  s += texture(uSrc, vUv + vec2(-t.x, 0.0)).rgb * 2.0;
  s += texture(uSrc, vUv).rgb * 4.0;
  s += texture(uSrc, vUv + vec2(t.x, 0.0)).rgb * 2.0;
  s += texture(uSrc, vUv + vec2(-t.x, t.y)).rgb;
  s += texture(uSrc, vUv + vec2(0.0, t.y)).rgb * 2.0;
  s += texture(uSrc, vUv + vec2(t.x, t.y)).rgb;
  o = vec4(s / 16.0, 1.0);
}`;

export const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform sampler2D uBloom;
uniform vec4 uParams;  // bloom, exposure, -, chromatic aberration
uniform vec4 uBg;
uniform vec4 uExtra;   // time, w, h
in vec2 vUv;
out vec4 o;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 center = vUv - 0.5;
  vec2 ca = center * uParams.w;
  vec3 scene = vec3(texture(uSrc, vUv - ca).r, texture(uSrc, vUv).g, texture(uSrc, vUv + ca).b);
  vec3 col = scene + texture(uBloom, vUv).rgb * uParams.x;
  float glow = exp(-pow(length(center * vec2(1.0, 1.6)) * 2.2, 2.0)) * 0.05;
  col += vec3(0.10, 0.22, 0.32) * glow;
  col = aces(col * uParams.y);
  float vig = smoothstep(0.95, 0.25, length(center * vec2(1.15, 1.0)));
  col = mix(uBg.rgb, col + uBg.rgb, vig * 0.85 + 0.15);
  float grain = (hash2(vUv * uExtra.yz + vec2(uExtra.x, uExtra.x * 1.7)) - 0.5) * 0.022;
  o = vec4(col + grain, 1.0);
}`;
