/**
 * X-ray: a live HUD that shows how the site works (the swarm, the edge, page vitals,
 * the agent and presence), a request map that lights up as traffic flows, and labels
 * over every [data-xray] element. One instance per page, shared by main.ts and the agent.
 */
import type { Telemetry } from '../main';
import type { SceneController } from '../scenes';

type Deps = { telemetry: Telemetry; scenes: () => SceneController | null };
export type Xray = { toggle(force?: boolean): void };
type Edge = NonNullable<Telemetry['edge']> & { httpProtocol?: string; tlsVersion?: string };
type Build = { git?: { sha?: string }; stats?: { jsGzipBytes?: number; cssGzipBytes?: number; dependencies?: number } };

let instance: Xray | null = null;
export function createXray(deps: Deps): Xray {
  return (instance ??= make(deps));
}

const NS = 'http://www.w3.org/2000/svg';
/** Which edges of the request map each telemetry event travels along. */
const ROUTES: Record<string, string[]> = {
  edge: ['be', 'ew'],
  agent: ['be', 'ew', 'ai'],
  presence: ['be', 'ew', 'do'],
  mcp: ['be', 'ew', 'mcp'],
  engine: ['be', 'ew', 'as'],
};
const kb = (n?: number) => `${((n ?? 0) / 1024).toFixed(1)} KB`;
const ms = (n?: number) => (typeof n === 'number' && n >= 0 ? `${Math.round(n)} ms` : '\u2014');
const gpu = (name: string) => {
  const m = /^ANGLE \(([^,]+),\s*(.+?)(?:,\s*[^,]+)?\)$/.exec(name);
  const s = (m ? m[2]! : name)
    .replace(/^ANGLE Metal Renderer:\s*/, '')
    .replace(/\s*\(0x[0-9a-f]+\)/gi, '')
    .replace(/\s*(Direct3D|vs_|ps_|OpenGL|Vulkan)[^,]*$/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '');
  return s.trim().slice(0, 48) || /SwiftShader|llvmpipe/i.exec(name)?.[0] || 'GPU';
};

const row = (k: string, label: string, span = false) => `<dt>${label}</dt><dd data-k="${k}"${span ? ' class="span"' : ''}>\u2014</dd>`;
const node = (k: string, x: number, y: number, w: number, label: string, gold = false) =>
  `<g class="node${gold ? ' gold' : ''}" data-n="${k}"><rect x="${x}" y="${y}" width="${w}" height="20" rx="5"/><text x="${x + w / 2}" y="${y + 13.4}" text-anchor="middle"${k === 'edge' ? ' data-k="enode"' : ''}>${label}</text></g>`;
const fan = (k: string, y: number) => `<path class="edge" data-e="${k}" d="M206 52C216 52 214 ${y} 224 ${y}"/>`;
const MAP = `<svg class="arch-svg" viewBox="0 0 300 104" role="img" aria-label="Request map: browser, Cloudflare edge, Worker, then static assets, OpenAI, the presence Durable Object and the MCP server"><path class="edge" data-e="be" d="M56 52H76"/><path class="edge" data-e="ew" d="M136 52H152"/>${fan('as', 10)}${fan('ai', 38)}${fan('do', 66)}${fan('mcp', 94)}${node('browser', 2, 42, 54, 'Browser')}${node('edge', 76, 42, 60, 'Edge', true)}${node('worker', 152, 42, 54, 'Worker', true)}${node('as', 224, 0, 76, 'Static assets')}${node('ai', 224, 28, 76, 'OpenAI')}${node('do', 224, 56, 76, 'Presence DO')}${node('mcp', 224, 84, 76, 'MCP server')}</svg>`;
const CLOSE = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const TEMPLATE = `<div class="hud-head"><span class="hud-title"><span class="dot" aria-hidden="true"></span><b>X-RAY</b></span><span class="row"><span data-k="sha">build \u2026</span><button class="btn btn--small" type="button" data-hud-close aria-label="Close X-ray">${CLOSE}</button></span></div>
<section><h3>Swarm <svg class="sparkline" viewBox="0 0 59 20" preserveAspectRatio="none" aria-hidden="true"><polyline points=""/></svg></h3><dl class="cols">${row('backend', 'backend')}${row('particles', 'particles')}${row('gpu', 'gpu', true)}${row('fps', 'fps')}${row('frame', 'frame')}${row('dpr', 'dpr')}${row('tier', 'tier')}${row('formation', 'formation', true)}</dl></section>
<section><h3>Edge</h3><dl class="cols">${row('colo', 'colo')}${row('rtt', 'round trip')}${row('where', 'where', true)}${row('proto', 'http')}${row('tls', 'tls')}${row('st', 'server-timing', true)}</dl></section>
<section><h3>Page</h3><dl class="cols">${row('dom', 'dom ready')}${row('lcp', 'LCP')}${row('cls', 'CLS')}${row('inp', 'slowest input')}${row('js', 'JS transferred', true)}${row('build', 'bundle', true)}</dl></section>
<section><h3>Agent</h3><dl class="cols">${row('model', 'model', true)}${row('lat', 'latency')}${row('steps', 'steps')}${row('tokens', 'tokens')}${row('fb', 'mode')}</dl></section>
<section><h3>Presence</h3><dl class="cols">${row('here', 'here now', true)}</dl></section>
<section><h3>Request map</h3>${MAP}</section>
<section><h3>Events</h3><ol class="hud-log" data-k="log"></ol></section>`;

function make({ telemetry: T, scenes }: Deps): Xray {
  const root = document.documentElement;
  const hud = document.querySelector<HTMLElement>('[data-hud]');
  const toggles = [...document.querySelectorAll<HTMLElement>('[data-xray-toggle]')];
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  if (!hud) return { toggle: (f) => void root.classList.toggle('xray-on', f) };

  hud.innerHTML = TEMPLATE;
  const out: Record<string, Element> = {};
  hud.querySelectorAll<HTMLElement | SVGElement>('[data-k]').forEach((e) => (out[e.dataset.k!] = e));
  const set = (k: string, v: string) => {
    const e = out[k];
    if (e && e.textContent !== v) e.textContent = v;
  };
  const svg = hud.querySelector<SVGSVGElement>('.arch-svg')!;
  const spark = hud.querySelector('.sparkline polyline')!;
  const edges: Record<string, SVGPathElement> = {};
  hud.querySelectorAll<SVGPathElement>('[data-e]').forEach((p) => (edges[p.dataset.e!] = p));
  const hot = new Map<Element, number>();
  const heat = (els: Element[], d: number) =>
    els.forEach((e) => {
      const n = (hot.get(e) ?? 0) + d;
      hot.set(e, n);
      e.classList.toggle('is-hot', n > 0);
    });

  let on = false;
  let timer = 0;
  let raf = 0;
  let frames = 0;
  let since = performance.now();
  let pageFps = 0;
  let dirty = true;
  let bundle = '';
  let logKey = '';
  let layer: HTMLElement | null = null;
  const fps: number[] = [];
  const vitals = { lcp: 0, cls: 0, inp: 0 };
  const labels = new Map<HTMLElement, HTMLElement>();
  const fixed = new WeakMap<Element, boolean>();

  // ---------- page vitals (passive observers, buffered so earlier entries count) ----------
  const observe = (type: string, cb: (list: PerformanceEntry[]) => void, extra: object = {}) => {
    try {
      new PerformanceObserver((l) => cb(l.getEntries())).observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
    } catch {
      /* entry type not supported here */
    }
  };
  observe('largest-contentful-paint', (l) => (vitals.lcp = l.at(-1)?.startTime ?? vitals.lcp));
  let windowSum = 0;
  let windowStart = 0;
  let windowLast = 0;
  observe('layout-shift', (l) => {
    for (const e of l as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
      if (e.hadRecentInput) continue;
      // CLS = the worst session window (shifts < 1 s apart, window < 5 s)
      if (e.startTime - windowLast > 1000 || e.startTime - windowStart > 5000) {
        windowSum = 0;
        windowStart = e.startTime;
      }
      windowSum += e.value;
      windowLast = e.startTime;
      vitals.cls = Math.max(vitals.cls, windowSum);
    }
  });
  // Longest interaction so far (Event Timing; only entries that belong to a real interaction).
  observe(
    'event',
    (l) => {
      for (const e of l as (PerformanceEntry & { interactionId?: number })[]) if (e.interactionId) vitals.inp = Math.max(vitals.inp, e.duration);
    },
    { durationThreshold: 16 },
  );

  const serverTiming = () => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const probe = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).filter((e) => e.name.includes('/api/edge')).at(-1);
    const all = [...(nav?.serverTiming ?? []), ...(probe?.serverTiming ?? [])];
    return all.map((t) => `${t.name}${t.duration ? ` ${+t.duration.toFixed(1)}ms` : ''}${t.description ? ` ${t.description}` : ''}`).join(' \u00b7 ') || 'none sent';
  };
  const jsLoaded = () => {
    const js = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).filter((e) => /\.m?js(\?|$)/.test(e.name));
    return `${kb(js.reduce((s, e) => s + (e.transferSize || e.encodedBodySize), 0))} \u00b7 ${js.length} files`;
  };

  // ---------- the HUD, 4× a second while visible ----------
  const tick = () => {
    if (document.hidden) return;
    const sc = scenes();
    const s = sc?.swarm.stats();
    const f = s?.fps ?? pageFps;
    fps.push(f);
    if (fps.length > 60) fps.shift();
    spark.setAttribute('points', fps.map((n, i) => `${i},${(19 - (Math.min(n, 60) / 60) * 18).toFixed(1)}`).join(' '));
    set('backend', s ? (s.backend === 'webgpu' ? 'WebGPU' : 'WebGL2') : 'off');
    set('particles', s ? s.particles.toLocaleString('en-GB') : '0');
    set('gpu', s ? gpu(s.gpu) : 'not running (poster)');
    set('fps', f ? String(f) : '\u2014');
    set('frame', s ? `${s.frameMs} ms` : f ? `${(1000 / f).toFixed(1)} ms` : '\u2014');
    set('dpr', String(s?.dpr ?? Math.round(devicePixelRatio * 100) / 100));
    set('tier', s ? String(s.tier) : '\u2014');
    set('formation', s?.formation ?? sc?.current() ?? '\u2014');

    const e = T.edge as Edge | undefined;
    set('colo', e?.colo ?? '\u2014');
    set('enode', e?.colo ? `Edge \u00b7 ${e.colo}` : 'Edge');
    set('rtt', ms(e?.rttMs));
    set('where', [e?.city, e?.country].filter(Boolean).join(', ') || '\u2014');
    set('proto', e?.protocol ?? e?.httpProtocol ?? '\u2014');
    set('tls', e?.tls ?? e?.tlsVersion ?? '\u2014');
    set('st', serverTiming());

    set('dom', ms(T.boot.domInteractive));
    set('lcp', vitals.lcp ? ms(vitals.lcp) : '\u2014');
    set('cls', vitals.cls.toFixed(3));
    set('inp', vitals.inp ? ms(vitals.inp) : 'none yet');
    set('js', jsLoaded());
    set('build', bundle || 'loading\u2026');

    const a = T.agent;
    set('model', a?.model ? (a.model.split('/').pop() ?? a.model) : 'idle \u00b7 press / to ask');
    set('lat', ms(a?.latencyMs));
    set('steps', a?.steps ? String(a.steps) : '\u2014');
    set('tokens', a?.tokens ? a.tokens.toLocaleString('en-GB') : '\u2014');
    set('fb', a ? (a.fallback ? 'offline fallback' : 'live model') : '\u2014');
    const here = T.presence?.here;
    set('here', here ? (here === 1 ? 'just you' : `${here} people${T.presence?.colo ? ` \u00b7 ${T.presence.colo}` : ''}`) : 'not connected');

    const recent = T.events.slice(-6).reverse();
    const key = recent.map((x) => x.t + x.kind).join();
    if (key !== logKey) {
      logKey = key;
      out.log!.replaceChildren(
        ...recent.map((x) => {
          const li = document.createElement('li');
          li.innerHTML = '<time></time><b></b><span></span>';
          const [t, k, d] = li.children;
          t!.textContent = `${(x.t / 1000).toFixed(1)}s`;
          k!.textContent = x.kind;
          d!.textContent = x.detail;
          return li;
        }),
      );
    }
  };

  // ---------- packets on the request map ----------
  const packet = (kind: string, detail: string) => {
    const route = ROUTES[kind];
    if (!route || !on) return;
    const back = kind === 'engine' || detail.startsWith('\u2190');
    const path = route.map((k) => edges[k]!);
    if (back) path.reverse();
    heat(path, 1);
    const end = () => heat(path, -1);
    if (still.matches) return void setTimeout(end, 900);
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('class', 'packet');
    dot.setAttribute('r', '2.6');
    const lens = path.map((p) => p.getTotalLength());
    const total = lens.reduce((x, y) => x + y, 0);
    const dur = 280 * path.length;
    const place = (k: number) => {
      let d = (1 - (1 - k) ** 2) * total;
      let i = 0;
      while (i < path.length - 1 && d > lens[i]!) d -= lens[i++]!;
      const p = path[i]!.getPointAtLength(back ? lens[i]! - d : d);
      dot.setAttribute('cx', p.x.toFixed(1));
      dot.setAttribute('cy', p.y.toFixed(1));
    };
    place(0);
    svg.append(dot);
    let t0 = 0;
    const step = (now: number) => {
      t0 ||= now; // the first frame starts the clock
      const k = Math.min(1, (now - t0) / dur);
      place(k);
      if (k < 1 && on) requestAnimationFrame(step);
      else {
        dot.remove();
        end();
      }
    };
    requestAnimationFrame(step);
  };

  // ---------- labels over [data-xray] elements, in one fixed layer ----------
  const isFixed = (el: Element) => {
    let f = fixed.get(el);
    if (f === undefined) {
      f = false;
      for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) if (getComputedStyle(n).position === 'fixed') f = true;
      fixed.set(el, f);
    }
    return f;
  };
  const place = () => {
    if (!layer) return;
    const top = (document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0) + 6;
    const panel = hud.getBoundingClientRect();
    let n = 0;
    for (const el of document.querySelectorAll<HTMLElement>('[data-xray]')) {
      const r = el.getBoundingClientRect();
      const pinned = isFixed(el);
      // Section labels stick under the header while their section is on screen.
      const y = pinned ? (r.top > 24 ? r.top - 20 : r.top + 4) : Math.max(r.top + 6, top);
      // Labels that would sit under the HUD step out to its right (or hide if there's no room).
      let x = Math.max(4, r.left + 6);
      if (x < panel.right && y + 16 > panel.top && y < panel.bottom) x = panel.right + 8;
      const show = n < 14 && r.width > 0 && r.bottom > y + 18 && y < innerHeight - 20 && r.right > 0 && x < innerWidth - 120 && getComputedStyle(el).visibility !== 'hidden';
      let label = labels.get(el);
      if (!show) {
        if (label) label.hidden = true;
        continue;
      }
      n++;
      if (!label) {
        label = document.createElement('span');
        label.className = 'xray-label';
        label.textContent = el.dataset.xray ?? '';
        labels.set(el, label);
        layer.append(label);
      }
      label.hidden = false;
      label.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }
  };
  const mark = () => (dirty = true);
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    frames++;
    if (now - since >= 1000) {
      pageFps = Math.round((frames * 1000) / (now - since));
      frames = 0;
      since = now;
    }
    if (dirty) {
      dirty = false;
      place();
    }
  };

  const toggle = (force?: boolean) => {
    const next = force ?? !on;
    if (next === on) return;
    on = next;
    root.classList.toggle('xray-on', on);
    try {
      sessionStorage.setItem('xray', on ? '1' : '0');
    } catch {
      /* storage blocked */
    }
    toggles.forEach((b) => b.setAttribute('aria-pressed', String(on)));
    hud.hidden = !on;
    if (on) {
      // The single-file preview (scripts/preview.ts) inlines build stats instead of serving /build.json.
      const inlined = (window as Window & { __LOD_BUILD?: Build }).__LOD_BUILD;
      if (!bundle)
        (inlined ? Promise.resolve(inlined) : fetch('/build.json').then((r) => r.json() as Promise<Build>))
          .then((b) => {
            bundle = `JS ${kb(b.stats?.jsGzipBytes)} \u00b7 CSS ${kb(b.stats?.cssGzipBytes)} gz \u00b7 ${b.stats?.dependencies ?? 0} deps`;
            set('sha', `build ${String(b.git?.sha ?? '?').slice(0, 7)}`);
          })
          .catch(() => (bundle = 'unavailable'));
      layer = document.createElement('div');
      layer.className = 'xray-layer';
      layer.setAttribute('aria-hidden', 'true');
      document.body.append(layer);
      addEventListener('scroll', mark, { passive: true });
      addEventListener('resize', mark);
      tick();
      timer = window.setInterval(() => {
        tick();
        dirty = true;
      }, 250);
      since = performance.now();
      frames = 0;
      raf = requestAnimationFrame(loop);
    } else {
      clearInterval(timer);
      cancelAnimationFrame(raf);
      removeEventListener('scroll', mark);
      removeEventListener('resize', mark);
      layer?.remove();
      layer = null;
      labels.clear();
      if (hud.contains(document.activeElement)) toggles.find((b) => b.offsetParent)?.focus();
    }
  };

  hud.querySelector('[data-hud-close]')!.addEventListener('click', () => toggle(false));
  hud.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    toggle(false);
  });
  addEventListener('lod:xray', (e) => toggle((e as CustomEvent<{ force?: boolean } | null>).detail?.force));
  addEventListener('lod:event', (e) => {
    const d = (e as CustomEvent<{ kind: string; detail: string }>).detail;
    if (d) packet(d.kind, String(d.detail ?? ''));
  });
  // The boot script may already have switched X-ray on (sessionStorage) before this module loaded.
  if (root.classList.contains('xray-on')) toggle(true);
  return { toggle };
}
