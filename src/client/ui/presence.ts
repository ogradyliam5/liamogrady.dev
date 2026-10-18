/**
 * Live presence: other visitors' pointers drift across the page as faint lights, and
 * pull on the swarm. One WebSocket to a Durable Object; nothing is stored or tracked.
 */
import type { Telemetry } from '../main';
import type { SceneController } from '../scenes';

type Deps = { emit: (kind: string, detail: string) => void; telemetry: Telemetry; scenes: () => SceneController | null };
type Peer = { c: string; x: number; y: number; s: number; el?: HTMLElement | undefined };
type In = { t?: unknown; id?: unknown; here?: unknown; peers?: unknown; c?: unknown; x?: unknown; y?: unknown; s?: unknown; n?: unknown };

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const unit = (v: number) => Math.min(1, Math.max(0, v));
/** Two-letter country code as text (flag emoji don't render on Windows). */
const cc = (v: unknown) => (typeof v === 'string' && /^[a-z]{2}$/i.test(v) ? v.toUpperCase() : '');

export function startPresence({ emit, telemetry, scenes }: Deps) {
  try {
    const layer = document.querySelector<HTMLElement>('.peers');
    if (!layer || !('WebSocket' in window)) return;
    const chips = [...document.querySelectorAll<HTMLElement>('[data-presence-count]')];
    const sections = [...document.querySelectorAll<HTMLElement>('main > section[id]')];
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live`;
    const peers = new Map<string, Peer>();
    let ws: WebSocket | null = null;
    let me = '';
    let here = 0;
    let opened = false;
    let paused = false;
    let tries = 0;
    let retry = 0;
    let hiddenTimer = 0;
    let raf = 0;
    let px = 0.5;
    let py = 0.5;
    let pointer = false;
    let moved = false;
    let sent = -1;

    const section = () => {
      const mid = innerHeight / 2;
      return Math.max(
        0,
        sections.findIndex((s) => {
          const r = s.getBoundingClientRect();
          return r.top <= mid && r.bottom > mid;
        }),
      );
    };
    const count = (n: number) => {
      here = Math.max(1, Math.round(n));
      telemetry.presence = { ...telemetry.presence, here };
      chips.forEach((c) => (c.textContent = here === 1 ? 'Just you, right now' : `${here} here now`));
    };

    const render = () => {
      raf = 0;
      const mine = section();
      const lights: { x: number; y: number; strength: number }[] = [];
      let n = 0;
      for (const p of peers.values()) {
        if (p.s < 0) continue; // no position yet
        if (n++ >= 24) {
          p.el?.remove();
          p.el = undefined;
          continue;
        }
        const same = p.s === mine;
        if (!p.el) {
          p.el = document.createElement('div');
          p.el.className = 'peer';
          p.el.textContent = p.c;
        }
        p.el.style.setProperty('--x', `${Math.round(p.x * innerWidth)}px`);
        p.el.style.setProperty('--y', `${Math.round(p.y * innerHeight)}px`);
        p.el.classList.toggle('is-idle', !same);
        if (!p.el.isConnected) layer.append(p.el);
        lights.push({ x: p.x, y: p.y, strength: same ? 1 : 0.3 });
      }
      scenes()?.swarm.peers(lights);
    };
    const paint = () => void (raf ||= requestAnimationFrame(render));

    const upsert = (m: In) => {
      const id = String(m.id ?? '');
      if (!id || id === me) return;
      let p = peers.get(id);
      if (!p) peers.set(id, (p = { c: '', x: 0, y: 0, s: -1 }));
      if (cc(m.c)) p.c = cc(m.c);
      if (p.el) p.el.textContent = p.c;
      if (num(m.x) && num(m.y)) {
        p.x = unit(m.x);
        p.y = unit(m.y);
        p.s = num(m.s) ? m.s : Math.max(0, p.s);
      }
    };
    const drop = (id: string) => {
      peers.get(id)?.el?.remove();
      peers.delete(id);
    };
    const clear = () => {
      [...peers.keys()].forEach(drop);
      paint();
    };

    const onMessage = (e: MessageEvent) => {
      let m: In;
      try {
        m = JSON.parse(String(e.data)) as In;
      } catch {
        return;
      }
      const id = String(m.id ?? '');
      if (m.t === 'welcome') {
        me = id;
        clear();
        (Array.isArray(m.peers) ? (m.peers as In[]) : []).forEach(upsert);
        count(num(m.here) ? m.here : peers.size + 1);
        emit('presence', `welcome \u00b7 ${here} here`);
      } else if (m.t === 'join' && id !== me && !peers.has(id)) {
        upsert(m);
        count(here + 1);
        emit('presence', `join \u00b7 ${cc(m.c) || 'someone'}`);
      } else if (m.t === 'leave' && id !== me) {
        drop(id);
        count(here - 1);
        emit('presence', 'leave');
      } else if (m.t === 'm') upsert(m);
      else if (m.t === 'n' && num(m.n)) count(m.n);
      paint();
    };

    const connect = () => {
      clearTimeout(retry);
      if (ws || paused) return;
      let sock: WebSocket;
      try {
        sock = new WebSocket(url);
      } catch {
        return;
      }
      ws = sock;
      sock.onopen = () => {
        opened = true;
        tries = 0;
        sent = -1;
      };
      sock.onmessage = onMessage;
      sock.onclose = () => {
        if (ws === sock) ws = null;
        clear();
        // Never connected (static preview, blocked): leave the chip as "Live" and stay quiet.
        if (paused || !opened) return;
        if (tries < 5) retry = window.setTimeout(connect, 1000 * 2 ** tries++ * (0.75 + Math.random() / 2));
        else chips.forEach((c) => (c.textContent = 'Live'));
      };
    };

    addEventListener(
      'pointermove',
      (e) => {
        px = unit(e.clientX / innerWidth);
        py = unit(e.clientY / innerHeight);
        pointer = moved = true;
      },
      { passive: true },
    );
    addEventListener('scroll', paint, { passive: true });
    addEventListener('resize', paint);
    // At most 4 updates a second, and only once the pointer has moved (or our section changed since).
    setInterval(() => {
      if (ws?.readyState !== WebSocket.OPEN || !pointer) return;
      const s = section();
      if (!moved && s === sent) return;
      moved = false;
      sent = s;
      ws.send(JSON.stringify({ t: 'm', x: Math.round(px * 1000) / 1000, y: Math.round(py * 1000) / 1000, s }));
    }, 250);
    setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('{"t":"p"}'), 25000);
    document.addEventListener('visibilitychange', () => {
      clearTimeout(hiddenTimer);
      if (document.hidden && opened)
        hiddenTimer = window.setTimeout(() => {
          paused = true;
          ws?.close(1000, 'hidden');
        }, 60000);
      else if (paused) {
        paused = false;
        tries = 0;
        connect();
      }
    });
    // /api/live lives on the same Worker as /api/edge: on a static host with no Worker the edge
    // probe fails, so don't knock on the socket either (no console noise, the chip stays "Live").
    if (telemetry.edge) connect();
    else {
      const wait = (e: Event) => {
        if ((e as CustomEvent<{ kind?: string }>).detail?.kind !== 'edge') return;
        removeEventListener('lod:event', wait);
        connect();
      };
      addEventListener('lod:event', wait);
    }
  } catch {
    /* presence is decoration: never break the page */
  }
}
