/**
 * Entry point. Everything here is progressive enhancement: the page is complete
 * without it. Heavy pieces (the GPU swarm, the agent, X-ray, presence, audio)
 * load lazily so first paint and interaction stay instant.
 */
type Lazy<T> = () => Promise<T>;

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)];

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
const idle = (fn: () => void, timeout = 1500) =>
  'requestIdleCallback' in window ? requestIdleCallback(fn, { timeout }) : setTimeout(fn, 200);

declare global {
  interface Window {
    __lod?: {
      scenes?: import('./scenes').SceneController | null;
      agent?: import('./ui/agent').AgentUI;
      telemetry: Telemetry;
    };
  }
}

export type Telemetry = {
  edge?: { colo: string; city?: string; country?: string; rttMs?: number; protocol?: string; tls?: string; ray?: string; serverMs?: number };
  boot: { domInteractive: number; engineMs?: number };
  agent?: { model?: string; latencyMs?: number; steps?: number; tokens?: number; fallback?: boolean };
  presence?: { here: number; colo?: string };
  events: { t: number; kind: string; detail: string }[];
};

const telemetry: Telemetry = {
  boot: { domInteractive: Math.round(performance.timing ? performance.timing.domInteractive - performance.timing.navigationStart : performance.now()) },
  events: [],
};
export const emit = (kind: string, detail: string) => {
  telemetry.events.push({ t: Math.round(performance.now()), kind, detail });
  if (telemetry.events.length > 60) telemetry.events.shift();
  dispatchEvent(new CustomEvent('lod:event', { detail: { kind, detail } }));
};
window.__lod = { telemetry };

// ---------- boot log ----------
function bootLine(key: string, htmlText: string) {
  const li = $(`[data-boot="${key}"]`);
  if (!li) return;
  li.innerHTML = htmlText;
  li.classList.add('is-on');
}
requestAnimationFrame(() => $$('[data-bootlog] li').forEach((li, i) => setTimeout(() => li.classList.add('is-on'), 120 * i)));

// ---------- reveals ----------
const revealIO = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('is-in');
        revealIO.unobserve(e.target);
      }
    }
  },
  { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
);
$$('.reveal, .split').forEach((el) => revealIO.observe(el));

// ---------- header + nav state ----------
const header = $('.site-header');
const onScroll = () => header?.classList.toggle('is-scrolled', scrollY > 24);
addEventListener('scroll', onScroll, { passive: true });
onScroll();
const navLinks = new Map($$<HTMLAnchorElement>('[data-nav]').map((a) => [a.dataset.nav!, a]));
const navIO = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      navLinks.forEach((a, id) => a.setAttribute('aria-current', String(id === e.target.id)));
    }
  },
  { rootMargin: '-45% 0px -50% 0px' },
);
$$('main > section[id]').forEach((s) => navIO.observe(s));

// The dock stays out of the way: hidden over the hero (it has its own button) and the
// contact form, tucked while you scroll down to read, back as soon as you scroll up.
const dock = $('[data-dock]');
if (dock) {
  // A shorter prompt where the full one would be cut off.
  const input = $<HTMLInputElement>('[data-dock-input]');
  const narrow = matchMedia('(max-width: 560px)');
  const fit = () => {
    if (!input) return;
    input.dataset.long ??= input.placeholder;
    input.placeholder = narrow.matches ? input.dataset.short ?? input.dataset.long : input.dataset.long;
  };
  fit();
  narrow.addEventListener('change', fit);
  const hero = $('#top');
  const contact = $('#contact');
  let overHero = !!hero;
  let overContact = false;
  let tucked = false;
  let lastY = scrollY;
  const sync = () => {
    const busy = dock.contains(document.activeElement);
    dock.classList.toggle('is-hidden', !busy && (overHero || overContact || tucked));
  };
  if (hero) new IntersectionObserver(([e]) => ((overHero = !!e && e.intersectionRatio > 0.35), sync()), { threshold: [0, 0.35, 0.6, 1] }).observe(hero);
  if (contact) new IntersectionObserver(([e]) => ((overContact = !!e && e.intersectionRatio > 0.2), sync()), { threshold: [0, 0.2, 0.5] }).observe(contact);
  addEventListener(
    'scroll',
    () => {
      const y = scrollY;
      if (Math.abs(y - lastY) < 10) return;
      tucked = y > lastY;
      lastY = y;
      sync();
    },
    { passive: true },
  );
  dock.addEventListener('focusout', () => setTimeout(sync, 0));
  sync();
}

// ---------- edge probe (where am I being served from?) ----------
async function probeEdge() {
  if (location.protocol === 'file:') {
    bootLine('edge', 'edge ........... <i>offline preview</i> · deploy to see the edge');
    return;
  }
  try {
    const t0 = performance.now();
    const res = await fetch('/api/edge', { cache: 'no-store' });
    const rtt = Math.round(performance.now() - t0);
    if (!res.ok) throw new Error(String(res.status));
    const e = (await res.json()) as Telemetry['edge'] & { colo: string };
    telemetry.edge = { ...e, rttMs: rtt };
    bootLine('edge', `edge ........... <b>${e.colo}</b>${e.city ? ` · ${e.city}` : ''} · ${rtt} ms round trip`);
    $$('[data-edge]').forEach((el) => (el.textContent = `Served from ${e.colo}${e.city ? ` (${e.city})` : ''} in ${rtt} ms`));
    emit('edge', `${e.colo} ${rtt}ms`);
  } catch {
    bootLine('edge', 'edge ........... <i>offline preview</i>');
  }
}

// ---------- lazy modules ----------
const once = <T>(fn: Lazy<T>): Lazy<T> => {
  let p: Promise<T> | null = null;
  return () => (p ??= fn());
};
const loadAgent = once(async () => {
  const m = await import('./ui/agent');
  const ui = m.createAgentUI({ emit, telemetry, scenes: () => window.__lod?.scenes ?? null });
  window.__lod!.agent = ui;
  return ui;
});
const loadXray = once(async () => (await import('./ui/xray')).createXray({ telemetry, scenes: () => window.__lod?.scenes ?? null }));
const loadSession = once(async () => (await import('./ui/session')).createSession({ scenes: () => window.__lod?.scenes ?? null }));

// Agent: open on click, "/" or ⌘K, or by submitting the dock.
$$('[data-agent-open]').forEach((b) => b.addEventListener('click', async () => (await loadAgent()).open()));
$('[data-dock-form]')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('[data-dock-input]');
  const q = input?.value.trim() ?? '';
  const ui = await loadAgent();
  ui.open();
  if (q) {
    ui.ask(q, q.length > 600 ? 'fit' : 'chat');
    if (input) input.value = '';
  }
});
$$<HTMLButtonElement>('[data-ask]').forEach((b) =>
  b.addEventListener('click', async () => {
    const ui = await loadAgent();
    const v = b.dataset.ask!;
    ui.open();
    if (v === 'fit' || v === 'architect') ui.setMode(v);
    else ui.ask(v, 'chat');
  }),
);
addEventListener('keydown', async (e) => {
  const t = e.target as HTMLElement;
  const typing = t.closest('input, textarea, [contenteditable="true"]');
  if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
    e.preventDefault();
    (await loadAgent()).open();
  } else if ((e.key === 'x' || e.key === 'X') && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
    (await loadXray()).toggle();
  }
});
// Warm the agent module once the page is idle, so the first open is instant.
idle(() => void loadAgent(), 4000);

// X-ray
$$('[data-xray-toggle]').forEach((b) => b.addEventListener('click', async () => (await loadXray()).toggle()));
if (document.documentElement.classList.contains('xray-on')) idle(async () => (await loadXray()).toggle(true));

// Generative reel
$$('[data-session]').forEach((b) => b.addEventListener('click', async () => (await loadSession()).toggle(b as HTMLButtonElement)));

// Copy buttons
$$<HTMLButtonElement>('[data-copy]').forEach((b) =>
  b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(b.dataset.copy!);
      const label = b.querySelector('span');
      const prev = label?.textContent;
      if (label) label.textContent = 'Copied';
      setTimeout(() => label && prev && (label.textContent = prev), 1400);
    } catch {
      /* clipboard blocked: nothing to do */
    }
  }),
);

// Contact form (small enough to keep in the entry chunk)
import('./ui/contact').then((m) => m.wireContact()).catch(() => {});

/** "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Laptop GPU (0x28E0) Direct3D11 vs_5_0 ps_5_0, D3D11)" → "NVIDIA GeForce RTX 4060 Laptop GPU" */
export function friendlyGpu(name: string): string {
  const m = /^ANGLE \(([^,]+),\s*(.+?)(?:,\s*[^,]+)?\)$/.exec(name);
  let s = m ? m[2]! : name;
  s = s.replace(/^ANGLE Metal Renderer:\s*/, '').replace(/\s*\(0x[0-9a-f]+\)/gi, '').replace(/\s*(Direct3D|vs_|ps_|OpenGL|Vulkan)[^,]*$/i, '').replace(/\s*\([^)]*\)\s*$/, '');
  return s.trim().slice(0, 48) || 'GPU';
}

// ---------- the swarm ----------
async function startSwarm() {
  const t0 = performance.now();
  const projects = $$('.project').length || 5;
  try {
    const { startScenes, swarmSkipReason } = await import('./scenes');
    const scenes = await startScenes({ reducedMotion, projects });
    window.__lod!.scenes = scenes;
    if (!scenes) {
      const why = swarmSkipReason();
      bootLine('gpu', `gpu ............ <i>${why || 'not available'}</i> · showing the still poster`);
      bootLine('swarm', 'swarm .......... <i>off</i>');
      return;
    }
    const s = scenes.swarm.stats();
    telemetry.boot.engineMs = Math.round(performance.now() - t0);
    const gpu = friendlyGpu(scenes.swarm.gpuName);
    bootLine('gpu', `gpu ............ <b>${scenes.swarm.backend === 'webgpu' ? 'WebGPU' : 'WebGL2'}</b> · ${gpu}`);
    bootLine('swarm', `swarm .......... <b>${s.particles.toLocaleString('en-GB')}</b> particles · ready in ${telemetry.boot.engineMs} ms${reducedMotion ? ' · still frames (reduced motion)' : ''}`);
    emit('engine', `${scenes.swarm.backend} ${s.particles}`);
  } catch (err) {
    console.warn('[swarm] failed to start', err);
    bootLine('gpu', 'gpu ............ <i>unavailable</i>');
  }
}

if (saveData) {
  bootLine('gpu', 'gpu ............ <i>skipped</i> · Save-Data is on');
  bootLine('swarm', 'swarm .......... <i>off</i>');
} else {
  // After first paint and the LCP text, never before.
  addEventListener('load', () => idle(startSwarm, 1200), { once: true });
}
probeEdge();
idle(() => import('./ui/presence').then((m) => m.startPresence({ emit, telemetry, scenes: () => window.__lod?.scenes ?? null })).catch(() => {}), 3000);
idle(() => import('./ui/webmcp').then((m) => m.registerWebMcp({ open: async (q?: string) => { const ui = await loadAgent(); ui.open(); if (q) ui.ask(q, 'chat'); } })).catch(() => {}), 2500);

// A note for the curious.
console.log(
  '%cLOG%c  Liam O\u2019Grady · liamogrady.dev\n%cYou opened the console, so you are my kind of person.\nPress X for X-ray, / to talk to my agent, or: curl liamogrady.dev',
  'font:600 14px Geist Mono, monospace;color:#05070b;background:#f2b94b;padding:2px 6px;border-radius:3px',
  'font:500 12px Geist, sans-serif;color:#eaeff5',
  'font:12px Geist, sans-serif;color:#8793a4',
);
