/**
 * Liam's agent: a non-modal dialog that streams answers from /api/agent (Server-Sent
 * Events), shows its work as trace chips, renders fit and architecture cards, and lets
 * the model drive the page (navigate, highlight, swarm scene, X-ray).
 *
 * Security: every network string reaches the DOM through textContent, esc() or md()
 * (which escapes first and only emits a fixed set of tags and https links).
 */
import type { Telemetry } from '../main';
import type { SceneController } from '../scenes';

export type Mode = 'chat' | 'fit' | 'architect';
export type AgentUI = { open(): void; close(): void; ask(q: string, mode?: Mode): void; setMode(m: Mode): void };
type Deps = { emit: (kind: string, detail: string) => void; telemetry: Telemetry; scenes: () => SceneController | null };
type Obj = Record<string, unknown>;
type SceneName = Parameters<SceneController['go']>[0];
type Turn = { role: 'user' | 'assistant'; content: string };
type Run = {
  q: string;
  mode: Mode;
  ctrl: AbortController;
  el: HTMLElement;
  trace: HTMLElement;
  cards: HTMLElement;
  pending: HTMLElement | null;
  bubble: HTMLElement;
  sources: HTMLElement;
  tools: Map<string, { el: HTMLElement; t: number; label: string }>;
  text: string;
  /** Card summaries and page actions, kept for the conversation history. */
  notes: string[];
  acts: string[];
  model: string;
  fallback: boolean;
  t0: number;
  raf: number;
  dog: number;
  done: boolean;
  timedOut: boolean;
};

const PLACEHOLDER: Record<Mode, string> = {
  chat: 'Ask about Liam\u2019s work',
  fit: 'Paste a job description',
  architect: 'Describe the problem',
};
const SUGGEST: [text: string, mode: Mode, setupOnly?: true][] = [
  ['What does Liam do at Avanade?', 'chat'],
  ['Show me his MCP work', 'chat'],
  ['Paste a job spec: is he a fit?', 'fit', true],
  ['Sketch an agent architecture for an IT helpdesk', 'architect'],
  ['How do I connect his MCP server to Copilot Studio?', 'chat'],
];
const ERRORS: Record<string, string> = {
  rate_limited: 'I\u2019m getting a lot of questions; try again in a minute.',
  bad_request: 'I couldn\u2019t take that one. Try rephrasing it, or keep it under 8,000 characters.',
  budget: 'Today\u2019s model budget is spent. Everything I know is on this page, or you can email Liam directly.',
  upstream: 'The model didn\u2019t answer just now. Try again in a moment.',
  network: 'I can\u2019t reach the server. Check your connection and try again.',
  timeout: 'That took too long, so I stopped waiting. Try again?',
};
const SCENES = 'orbits fields graph constellation journey badges drift banjo globe signoff'.split(' ');
const SECTIONS = 'top about capabilities work journey credentials writing offline agents contact'.split(' ');

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const narrow = () => matchMedia('(max-width: 640px)').matches;
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]!);
const UNESC: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}\u2026` : s);
const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
const I_SEND = svg('M4 12 20 4l-6 16-3-7-7-1z');
const I_RETRY = svg('M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4');

/** "@cf/meta/llama-3.3-70b-instruct-fp8-fast" → "llama-3.3-70b" */
/** "gpt-6-luna" -> "GPT-6 Luna"; Workers AI ids lose their path and quantisation suffixes. */
const friendly = (m: string) => {
  const id = (m.split('/').pop() ?? m).replace(/-(instruct|chat|fp8|fast|awq|int8|it)\b/g, '');
  const gpt = /^gpt-([\d.]+)(?:-(.+))?$/i.exec(id);
  if (gpt) return cut(`GPT-${gpt[1]}${gpt[2] ? ' ' + gpt[2].split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : ''}`, 28);
  return cut(id, 28);
};

/** https links and #section anchors only (plus http for sources); everything else stays text. */
function href(u: string, http = false): string | null {
  if (/^#[\w-]+$/.test(u)) return u;
  try {
    const url = new URL(u, location.href);
    return url.protocol === 'https:' || (http && url.protocol === 'http:') ? url.href : null;
  } catch {
    return null;
  }
}
const ext = (h: string) => (h.startsWith('#') ? '' : ' target="_blank" rel="noopener"');

/** Inline markdown on escaped text: `code`, [links](https://…), **bold**, *em*. */
function inline(s: string): string {
  const keep: string[] = [];
  const stash = (h: string) => `\u0000${keep.push(h) - 1}\u0000`;
  return esc(s.replace(/\u0000/g, ''))
    .replace(/`([^`\n]+)`/g, (_, c: string) => stash(`<code>${c}</code>`))
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_, t: string, u: string) => {
      const h = href(u.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => UNESC[e]!));
      return h ? stash(`<a href="${esc(h)}"${ext(h)}>${t}</a>`) : t;
    })
    .replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])[*_](?=\S)([^*_\n]*?\S)[*_](?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>')
    .replace(/\u0000(\d+)\u0000/g, (_, i: string) => keep[+i] ?? '');
}

/** Block markdown: paragraphs, "- " / "1. " lists and headings (rendered as bold lines). */
function md(src: string): string {
  let out = '';
  let list = '';
  let para: string[] = [];
  const flush = () => {
    if (para.length) out += `<p>${para.map(inline).join('<br>')}</p>`;
    para = [];
  };
  const end = () => {
    if (list) out += `</${list}>`;
    list = '';
  };
  for (const line of src.split('\n')) {
    const li = /^\s*(?:[-*\u2022]|(\d+)[.)])\s+(.+)/.exec(line);
    const hd = /^#{1,6}\s+(.+)/.exec(line);
    if (li) {
      flush();
      const tag = li[1] ? 'ol' : 'ul';
      if (list !== tag) {
        end();
        out += `<${tag}>`;
        list = tag;
      }
      out += `<li>${inline(li[2]!)}</li>`;
    } else if (hd) {
      flush();
      end();
      out += `<p><strong>${inline(hd[1]!)}</strong></p>`;
    } else if (!line.trim()) {
      flush();
      end();
    } else {
      end();
      para.push(line.trim());
    }
  }
  flush();
  end();
  return out;
}

const list = (title: string, v: unknown) => {
  const items = arr(v).map(str).filter(Boolean);
  return items.length ? `<h4>${title}</h4><ul>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>` : '';
};

function sectionInView(): string {
  const mid = innerHeight / 2;
  for (const s of document.querySelectorAll<HTMLElement>('main > section[id]')) {
    const r = s.getBoundingClientRect();
    if (r.top <= mid && r.bottom >= mid) return s.id;
  }
  return 'top';
}

export function createAgentUI(deps: Deps): AgentUI {
  const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s);
  const panel = $('[data-panel]');
  const log = $('[data-log]');
  const form = $<HTMLFormElement>('[data-agent-form]');
  const input = $<HTMLTextAreaElement>('[data-agent-input]');
  if (!panel || !log || !form || !input) return { open() {}, close() {}, ask() {}, setMode() {} };
  const chip = $('[data-agent-model]');
  const modeButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-mode]')];
  const openers = [...document.querySelectorAll<HTMLElement>('[data-agent-open]')];
  const root = document.documentElement;

  const actions = new WeakMap<Element, () => void>();
  const highlights = new Map<Element, number>();
  const history: Turn[] = [];
  let mode: Mode = 'chat';
  let isOpen = false;
  let opener: HTMLElement | null = null;
  let run: Run | null = null;
  let energy = 0;
  // Log auto-scroll: follow new content, but never push the current question off the top.
  let stick = true;
  let anchor: HTMLElement | null = null;
  let ownScroll = -1;

  panel.tabIndex = -1;
  openers.forEach((b) => b.setAttribute('aria-expanded', 'false'));
  input.setAttribute('enterkeyhint', 'send');
  input.placeholder = PLACEHOLDER[mode];

  const h = (tag: string, cls = '', html = '') => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html) e.innerHTML = html;
    return e;
  };
  const text = (tag: string, cls: string, t: string) => {
    const e = h(tag, cls);
    e.textContent = t;
    return e;
  };
  const button = (cls: string, html: string, fn: () => void) => {
    const b = h('button', cls, html) as HTMLButtonElement;
    b.type = 'button';
    actions.set(b, fn);
    return b;
  };
  const go = (el: Element, block: ScrollLogicalPosition) => el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block });

  const follow = () => {
    if (!stick) return;
    const max = log.scrollHeight - log.clientHeight;
    const to = anchor?.isConnected ? Math.min(max, anchor.getBoundingClientRect().top - log.getBoundingClientRect().top + log.scrollTop - 12) : max;
    if (to > log.scrollTop + 1) {
      log.scrollTop = to;
      ownScroll = log.scrollTop;
    }
  };
  log.addEventListener(
    'scroll',
    () => {
      if (Math.abs(log.scrollTop - ownScroll) < 2) return;
      stick = log.scrollHeight - log.scrollTop - log.clientHeight < 32;
      if (stick) anchor = null;
    },
    { passive: true },
  );

  // ---------- page actions the model can take ----------
  const highlight = (el: HTMLElement) => {
    go(el, 'center');
    el.classList.add('is-highlighted');
    clearTimeout(highlights.get(el));
    highlights.set(el, window.setTimeout(() => el.classList.remove('is-highlighted'), 6000));
  };
  const uiAction = (action: string, args: Obj): { label: string; run: (() => void) | null; href?: string | undefined } => {
    const v = str(args.section ?? args.target ?? args.name ?? args.scene ?? args.id);
    if (action === 'navigate') {
      const el = /^[\w-]+$/.test(v) ? document.getElementById(v) : null;
      return { label: `navigate \u2192 ${v}`, run: el && (() => go(el, 'start')), href: !el && SECTIONS.includes(v) ? `/#${v}` : undefined };
    }
    if (action === 'highlight') {
      const el = /^[\w-]+:[\w.-]+$/.test(v) ? $(`[data-highlight="${v}"]`) : null;
      return { label: `highlight \u2192 ${v}`, run: el && (() => highlight(el)) };
    }
    if (action === 'scene') return { label: `scene \u2192 ${v}`, run: SCENES.includes(v) ? () => deps.scenes()?.go(v as SceneName) : null };
    if (action === 'open_xray') return { label: 'open X-ray', run: () => dispatchEvent(new CustomEvent('lod:xray', { detail: { force: true } })) };
    return { label: cut(action || 'action', 24), run: null };
  };
  // The agent opens X-ray by event; load the module on demand (it is a per-page singleton).
  addEventListener('lod:xray', (e) => {
    const force = (e as CustomEvent<{ force?: boolean } | null>).detail?.force;
    if (typeof force === 'boolean') import('./xray').then((m) => m.createXray({ telemetry: deps.telemetry, scenes: deps.scenes }).toggle(force)).catch(() => {});
  });

  // ---------- cards ----------
  const stagger = (el: HTMLElement, sel: string) => el.querySelectorAll<HTMLElement>(sel).forEach((x, i) => x.style.setProperty('--i', String(i)));

  const fitCard = (d: Obj) => {
    const score = Math.max(0, Math.min(100, Math.round(Number(d.overall) || 0)));
    const role = cut(str(d.role) || 'This role', 90);
    const company = cut(str(d.company), 60);
    const reqs = arr(d.requirements).map(obj);
    const req = (r: Obj) => {
      const m = ['strong', 'partial', 'gap'].includes(str(r.match)) ? str(r.match) : 'partial';
      const s = str(r.source);
      const link = href(s) ?? (SECTIONS.includes(s) ? `#${s}` : null);
      const src = link ? ` <a href="${esc(link)}"${ext(link)}>source</a>` : s ? ` <span class="muted">\u00b7 ${esc(cut(s, 60))}</span>` : '';
      const ev = str(r.evidence);
      return `<div class="req"><span class="badge ${m}">${m}</span><strong>${inline(str(r.requirement))}</strong>${ev || src ? `<p>${inline(ev)}${src}</p>` : ''}</div>`;
    };
    const el = h(
      'article',
      'gen',
      `<header class="gen-head"><div><strong>${esc(role)}</strong>${company ? `<span class="muted"> at ${esc(company)}</span>` : ''}<p class="meta-line">Fit check against the public profile</p></div><span class="score">${score}<small>/100</small></span></header><div class="gen-body"><div class="meter" role="meter" aria-label="Overall fit" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${score}"><i></i></div>${str(d.verdict) ? `<p>${inline(str(d.verdict))}</p>` : ''}${reqs.length ? `<h4>Requirements</h4><div>${reqs.map(req).join('')}</div>` : ''}${list('Strengths', d.strengths)}${list('Gaps', d.gaps)}${list('Worth asking', d.questions)}</div>`,
    );
    el.setAttribute('aria-label', `Fit check: ${score} out of 100`);
    stagger(el, '.req');
    const bar = el.querySelector<HTMLElement>('.meter > i')!;
    const num = el.querySelector('.score')!.firstChild!;
    // Once in the document: flush styles at 0, then fill the meter and count the score up.
    const mount = () => {
      void bar.offsetWidth;
      bar.style.setProperty('--v', String(score));
      if (reduced()) return;
      const t0 = performance.now();
      const tick = (now: number) => {
        const k = Math.min(1, Math.max(0, now - t0) / 1100);
        num.textContent = String(Math.round(score * (1 - (1 - k) ** 3)));
        if (k < 1) requestAnimationFrame(tick);
      };
      num.textContent = '0';
      requestAnimationFrame(tick);
    };
    return { el, mount, note: `[Fit check shown: ${score}/100 for ${role}${company ? ` at ${company}` : ''}. ${str(d.verdict)}]` };
  };

  const discuss = (title: string) => {
    const msg = $<HTMLTextAreaElement>('#c-message');
    if (!msg) return void location.assign('/#contact');
    const hello = $<HTMLInputElement>('input[name="kind"][value="hello"]');
    if (hello && !hello.checked) {
      hello.checked = true;
      hello.dispatchEvent(new Event('change', { bubbles: true }));
    }
    msg.value = `I\u2019d like to talk through the architecture your agent sketched: \u201c${title}\u201d.\n\n`;
    close();
    const contact = document.getElementById('contact');
    if (contact) go(contact, 'start');
    // Land on the first field still to fill in (the message is already drafted).
    const next = [...document.querySelectorAll<HTMLInputElement>('#c-name, #c-email')].find((f) => !f.value) ?? msg;
    setTimeout(() => next.focus({ preventScroll: true }), reduced() ? 60 : 700);
  };

  const archCard = (d: Obj) => {
    const title = cut(str(d.title) || 'Agent architecture', 120);
    const layers = arr(d.layers).map(obj);
    const comp = (c: Obj) => {
      const purpose = str(c.purpose);
      return `<div class="arch-comp"${purpose ? ` title="${esc(purpose)}"` : ''}><b>${esc(str(c.name))}</b>${str(c.tech) ? `<small>${esc(str(c.tech))}</small>` : ''}${purpose ? `<span class="sr-only">: ${esc(purpose)}</span>` : ''}</div>`;
    };
    const flow = arr(d.flow).map(str).filter(Boolean);
    const phases = arr(d.phases).map(obj);
    const el = h(
      'article',
      'gen',
      `<header class="gen-head"><div><strong>${esc(title)}</strong><p class="meta-line">Architecture sketch \u00b7 ${layers.length} layers</p></div></header><div class="gen-body">${str(d.problem) ? `<p class="muted">${inline(str(d.problem))}</p>` : ''}${str(d.summary) ? `<p>${inline(str(d.summary))}</p>` : ''}${
        layers.length ? `<div class="arch">${layers.map((l) => `<div class="arch-layer"><span>${esc(cut(str(l.name), 40))}</span><div class="arch-comps">${arr(l.components).map(obj).map(comp).join('')}</div></div>`).join('')}</div>` : ''
      }${flow.length ? `<h4>Flow</h4><ol class="arch-flow">${flow.map((f) => `<li>${inline(f)}</li>`).join('')}</ol>` : ''}${list('Governance', d.governance)}${
        phases.length ? `<h4>Phases</h4><ul>${phases.map((p) => `<li><b>${esc(str(p.name))}</b>${str(p.weeks) ? ` \u00b7 ${esc(str(p.weeks))} weeks` : ''}${str(p.outcome) ? `: ${inline(str(p.outcome))}` : ''}</li>`).join('')}</ul>` : ''
      }${list('Risks', d.risks)}</div>`,
    );
    el.setAttribute('aria-label', `Architecture sketch: ${title}`);
    stagger(el, '.arch-layer');
    const row = h('div', 'row');
    row.append(button('btn btn--small', `${I_SEND}<span>Discuss this with Liam</span>`, () => discuss(title)));
    el.querySelector('.gen-body')!.append(row);
    return { el, mount: () => {}, note: `[Architecture sketch shown: ${title}]` };
  };

  const addSources = (r: Run, data: unknown) => {
    const items = (Array.isArray(data) ? data : arr(obj(data).items)).map(obj);
    const seen = new Set([...r.sources.querySelectorAll('a')].map((a) => a.href));
    for (const it of items) {
      const u = href(str(it.url), true);
      if (!u || seen.has(u) || seen.size >= 6) continue;
      seen.add(u);
      if (!r.sources.childElementCount) r.sources.append(text('span', 'meta-line', 'Sources'));
      const a = text('a', '', cut(str(it.title) || u.replace(/^https?:\/\/(www\.)?/, ''), 48)) as HTMLAnchorElement;
      a.href = u;
      if (!u.startsWith('#')) {
        a.target = '_blank';
        a.rel = 'noopener';
      }
      r.sources.append(a);
    }
    r.sources.hidden = !r.sources.childElementCount;
  };

  // ---------- streaming ----------
  const startEnergy = () => {
    clearInterval(energy);
    const pump = () => deps.scenes()?.swarm.energy(0.8);
    pump();
    energy = window.setInterval(pump, 150);
  };
  const paint = (r: Run) => {
    r.raf ||= requestAnimationFrame(() => {
      r.raf = 0;
      r.bubble.innerHTML = md(r.text);
      follow();
    });
  };
  const watchdog = (r: Run) => {
    clearTimeout(r.dog);
    r.dog = window.setTimeout(() => {
      r.timedOut = true;
      r.ctrl.abort();
    }, 45000);
  };
  /** Common wrap-up for done, error and cancel. Returns what the assistant said, for the history. */
  const settle = (r: Run, tail: string) => {
    r.done = true;
    clearTimeout(r.dog);
    cancelAnimationFrame(r.raf);
    if (run === r) clearInterval(energy);
    r.pending?.remove();
    r.pending = null;
    if (r.text) {
      // A fresh node, so screen readers announce the finished answer once (the draft was aria-hidden).
      const b = h('div', 'bubble', md(r.text));
      r.bubble.replaceWith(b);
      r.bubble = b;
    } else r.bubble.remove();
    if (tail) r.el.append(text('p', 'meta-line', tail));
    follow();
    return [r.text.trim(), ...r.notes].filter(Boolean).join('\n\n');
  };
  const remember = (said: string) => {
    if (said) history.push({ role: 'assistant', content: cut(said, 6000) });
    else if (history.at(-1)?.role === 'user') history.pop(); // keep user/assistant turns alternating
  };

  const finish = (r: Run, ev: Obj = {}) => {
    if (r.done) return;
    const usage = obj(ev.usage);
    const tokens = (Number(usage.inputTokens) || 0) + (Number(usage.outputTokens) || 0);
    const latencyMs = Math.round(Number(ev.latencyMs) || performance.now() - r.t0);
    const steps = Number(ev.steps) || 0;
    const model = str(ev.model) || r.model;
    const meta = [model && friendly(model), `${(latencyMs / 1000).toFixed(1)} s`, tokens && `${tokens.toLocaleString('en-GB')} tokens`, steps && `${steps} step${steps === 1 ? '' : 's'}`, r.fallback && 'offline mode'];
    const said = settle(r, meta.filter(Boolean).join(' \u00b7 '));
    remember(said || (r.acts.length ? `(Moved the page: ${r.acts.join(', ')})` : ''));
    deps.telemetry.agent = { model, latencyMs, steps, tokens, fallback: r.fallback };
    deps.emit('agent', `\u2190 ${friendly(model) || 'agent'} \u00b7 ${latencyMs} ms`);
    deps.scenes()?.swarm.pulse();
  };

  const fail = (r: Run, code: string) => {
    if (r.done) return;
    const known = ERRORS[code] ? code : 'upstream';
    remember(settle(r, ''));
    const offline = known === 'network' && location.protocol === 'file:';
    r.el.append(h('div', 'bubble', `<p>${esc(offline ? 'I answer on the live site; this offline preview can\u2019t reach my server.' : ERRORS[known])}</p>`));
    if (known !== 'bad_request' && known !== 'budget') {
      const row = h('div', 'row');
      row.append(
        button('btn btn--small', `${I_RETRY}<span>Try again</span>`, () => {
          const u = r.el.previousElementSibling as HTMLElement | null;
          r.el.remove();
          void request(r.q, r.mode, u);
        }),
      );
      r.el.append(row);
    }
    r.el.append(text('p', 'meta-line', `error \u00b7 ${known.replace('_', ' ')}`));
    deps.emit('agent', `\u2715 ${known}`);
    follow();
  };

  const cancel = () => {
    const r = run;
    if (!r || r.done) return;
    r.ctrl.abort();
    remember(settle(r, 'stopped'));
  };

  const onEvent = (r: Run, ev: Obj) => {
    switch (ev.type) {
      case 'meta': {
        r.model = str(ev.model);
        r.fallback = ev.fallback === true;
        deps.telemetry.agent = { ...deps.telemetry.agent, model: r.model, fallback: r.fallback };
        if (chip && (r.model || r.fallback)) {
          chip.textContent = r.fallback ? 'offline mode' : friendly(r.model);
          chip.title = `Answers come only from Liam\u2019s public profile${str(ev.colo) ? ` \u00b7 served from ${str(ev.colo)}` : ''}`;
        }
        break;
      }
      case 'status':
        if (r.pending && str(ev.text)) r.pending.lastElementChild!.textContent = cut(str(ev.text), 80);
        break;
      case 'tool': {
        // UI tools surface through their "ui" event instead, so they are not shown twice.
        if (ev.kind === 'ui') break;
        const args = obj(ev.args);
        const first = Object.values(args).find((v) => typeof v === 'string') as string | undefined;
        const label = `${cut(str(ev.name) || 'tool', 28)}${first ? ` \u201c${cut(first, 24)}\u201d` : ''}`;
        const el = text('span', 'chip is-pending', label);
        r.tools.set(str(ev.id) || String(r.tools.size), { el, t: performance.now(), label });
        r.trace.append(el);
        r.trace.hidden = false;
        deps.emit('mcp', `tool ${str(ev.name)}`);
        break;
      }
      case 'tool_result': {
        const t = r.tools.get(str(ev.id)) ?? [...r.tools.values()].find((x) => x.el.classList.contains('is-pending') && x.label.startsWith(str(ev.name) || '\u0000'));
        if (!t) break;
        t.el.classList.remove('is-pending');
        t.el.textContent = `${t.label} \u00b7 ${Math.round(performance.now() - t.t)} ms${ev.ok === false ? ' \u00b7 failed' : ''}`;
        if (str(ev.summary)) t.el.title = str(ev.summary);
        break;
      }
      case 'ui': {
        const a = uiAction(str(ev.action), obj(ev.args));
        const el = a.href ? text('a', 'chip is-ui', a.label) : a.run ? button('chip is-ui', esc(a.label), () => (a.run!(), narrow() && close())) : text('span', 'chip is-ui', a.label);
        if (a.href) (el as HTMLAnchorElement).href = a.href;
        if (a.run) el.title = 'Do it again';
        r.trace.append(el);
        r.trace.hidden = false;
        r.acts.push(a.label);
        a.run?.();
        break;
      }
      case 'card': {
        if (ev.kind === 'sources') addSources(r, ev.data);
        else if (ev.kind === 'fit' || ev.kind === 'architecture') {
          const c = (ev.kind === 'fit' ? fitCard : archCard)(obj(ev.data));
          r.cards.append(c.el);
          r.cards.hidden = false;
          c.mount();
          r.notes.push(c.note);
        }
        follow();
        break;
      }
      case 'text':
        if (typeof ev.delta !== 'string' || !ev.delta) break;
        r.text += ev.delta;
        r.pending?.remove();
        r.pending = null;
        paint(r);
        break;
      case 'done':
        finish(r, ev);
        break;
      case 'error':
        fail(r, str(ev.code));
        break;
    }
  };

  const onBlock = (r: Run, block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(l[5] === ' ' ? 6 : 5))
      .join('\n');
    if (!data || data === '[DONE]' || r.done) return;
    try {
      onEvent(r, obj(JSON.parse(data)));
    } catch {
      /* a malformed event is skipped, not fatal */
    }
  };

  /**
   * No server (static preview, outage, Worker not deployed yet): answer from the public
   * profile with deterministic retrieval, using exactly the same event stream.
   */
  const answerOffline = async (r: Run) => {
    const off = await import('../../shared/offline');
    const wait = (ms: number) => new Promise((res) => setTimeout(res, reduced() ? 0 : ms));
    const evs: Obj[] =
      r.mode === 'fit'
        ? [
            { type: 'tool', id: 'f1', name: 'assess_fit', args: { job_description: cut(r.q, 60) }, kind: 'data' },
            { type: 'tool_result', id: 'f1', name: 'assess_fit', ok: true, summary: 'retrieval scoring' },
            { type: 'card', kind: 'fit', data: off.assessFit(r.q) },
            { type: 'text', delta: 'That is a retrieval-only fit check: each requirement is scored against the public profile. The live agent adds judgement, and the full CV fills in what the public profile leaves out.' },
          ]
        : r.mode === 'architect'
          ? [
              { type: 'card', kind: 'architecture', data: off.REFERENCE_ARCHITECTURE },
              { type: 'text', delta: 'Here is the reference shape Liam usually starts from. The live agent tailors it to your problem; either way, it is a starting point for a conversation, not a design.' },
            ]
          : (off.offlineChat(r.q) as unknown as Obj[]);
    onEvent(r, { type: 'meta', model: 'offline retrieval', fallback: true });
    for (const ev of evs) {
      if (r.done) return;
      if (ev.type === 'text') {
        const words = String(ev.delta).split(/(?<=\s)/);
        for (let i = 0; i < words.length && !r.done; i += 4) {
          onEvent(r, { type: 'text', delta: words.slice(i, i + 4).join('') });
          await wait(24);
        }
      } else {
        onEvent(r, ev);
        await wait(140);
      }
    }
    if (!r.done) onEvent(r, { type: 'done', usage: { inputTokens: 0, outputTokens: 0 }, latencyMs: Math.round(performance.now() - r.t0), steps: 1, model: 'offline retrieval' });
  };

  const request = async (q: string, m: Mode, userEl: HTMLElement | null) => {
    cancel();
    history.push({ role: 'user', content: q });
    const r: Run = {
      q,
      mode: m,
      ctrl: new AbortController(),
      el: h('div', 'msg msg--agent'),
      trace: h('div', 'trace'),
      cards: h('div', 'stack'),
      pending: h('div', 'row', '<span class="typing" aria-hidden="true"><i></i><i></i><i></i></span><span class="meta-line">Thinking\u2026</span>'),
      bubble: h('div', 'bubble is-streaming'),
      sources: h('div', 'sources'),
      tools: new Map(),
      text: '',
      notes: [],
      acts: [],
      model: '',
      fallback: false,
      t0: performance.now(),
      raf: 0,
      dog: 0,
      done: false,
      timedOut: false,
    };
    r.trace.hidden = r.cards.hidden = r.sources.hidden = true;
    r.bubble.setAttribute('aria-hidden', 'true');
    r.el.append(r.trace, r.cards, r.pending!, r.bubble, r.sources);
    log.append(r.el);
    run = r;
    anchor = userEl;
    stick = true;
    follow();
    startEnergy();
    const section = sectionInView();
    deps.emit('agent', `\u2192 ${m} \u00b7 #${section}`);
    let messages = history.slice(-12);
    if (messages[0]?.role === 'assistant') messages = messages.slice(1);
    watchdog(r);
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ messages, mode: m, section }),
        signal: r.ctrl.signal,
      });
      if (!res.ok || !res.body || !/event-stream/.test(res.headers.get('content-type') ?? '')) {
        const body = obj(await res.json().catch(() => null));
        const code = str(body.code) || str(obj(body.error).code) || str(body.error);
        if (!ERRORS[code] && (res.status === 404 || res.status === 405 || res.status >= 500)) return answerOffline(r);
        return fail(r, ERRORS[code] ? code : res.status === 429 ? 'rate_limited' : res.status === 400 || res.status === 413 ? 'bad_request' : 'upstream');
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (r.done) break;
        buf += decoder.decode(value, { stream: !done });
        // Events end with a blank line; a chunk can stop anywhere, so keep the tail for next time.
        const blocks = buf.split(/\r?\n\r?\n/);
        buf = done ? '' : blocks.pop()!;
        for (const b of blocks) onBlock(r, b);
        if (done || r.done) break;
        watchdog(r);
      }
      reader.cancel().catch(() => {});
      // The stream ended without "done": keep what arrived, or report that nothing did.
      if (r.text || r.notes.length || r.acts.length) finish(r);
      else fail(r, 'upstream');
    } catch {
      if (r.done) return;
      if (r.timedOut) fail(r, 'timeout');
      else await answerOffline(r);
    }
  };

  // ---------- panel ----------
  const welcome = () => {
    const w = h(
      'div',
      'welcome',
      '<p class="title">Ask me about <em>Liam.</em></p><p>I\u2019m Liam\u2019s agent, grounded only in what\u2019s published on this site. Ask about his work, paste a job description for a fit assessment, or describe a problem and I\u2019ll sketch an agent architecture. I can navigate the page for you as I answer.</p><p class="muted small">Answers are generated by OpenAI from the public profile. Please don\u2019t share anything confidential.</p>',
    );
    const s = h('div', 'suggest');
    for (const [t, m, setup] of SUGGEST) s.append(button('', esc(t), () => (setup ? setMode(m) : ask(t, m))));
    w.append(s);
    log.append(w);
  };

  const open = () => {
    if (!isOpen) {
      isOpen = true;
      const a = document.activeElement as HTMLElement | null;
      opener = a && a !== document.body && !panel.contains(a) ? a : null;
      if (!log.childElementCount) welcome();
      panel.classList.add('is-open');
      panel.setAttribute('aria-hidden', 'false');
      root.classList.add('agent-open');
      openers.forEach((b) => b.setAttribute('aria-expanded', 'true'));
    }
    // On touch screens, keep the keyboard closed while the suggestions are showing.
    const landing = matchMedia('(pointer: coarse)').matches && log.querySelector('.welcome') ? panel : input;
    landing.focus({ preventScroll: true });
  };

  const close = () => {
    if (!isOpen) return;
    isOpen = false;
    panel.classList.remove('is-open');
    panel.setAttribute('aria-hidden', 'true');
    root.classList.remove('agent-open');
    openers.forEach((b) => b.setAttribute('aria-expanded', 'false'));
    if (panel.contains(document.activeElement)) {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      else (document.activeElement as HTMLElement).blur();
    }
    opener = null;
  };

  const setMode = (m: Mode, focus = true) => {
    if (!PLACEHOLDER[m]) return;
    mode = m;
    modeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    input.placeholder = PLACEHOLDER[m];
    if (focus) {
      open();
      input.focus({ preventScroll: true });
    }
  };

  const ask = (q: string, m?: Mode) => {
    q = q.trim().slice(0, 8000);
    if (!q) return;
    if (m) setMode(m, false);
    open();
    log.querySelector('.welcome')?.remove();
    const u = h('div', 'msg msg--user');
    u.append(text('div', 'bubble', q));
    log.append(u);
    void request(q, mode, u);
  };

  const grow = () => {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight + 2}px`;
  };
  const send = () => {
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    grow();
    ask(q);
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    send();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });
  input.addEventListener('input', grow);
  modeButtons.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode as Mode)));
  $('[data-agent-close]')?.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen && !e.defaultPrevented && !e.isComposing && !(e.target as Element).closest?.('[data-hud]')) close();
  });
  log.addEventListener('click', (e) => {
    const t = e.target as Element;
    const b = t.closest('button');
    const fn = b && actions.get(b);
    if (fn) return fn();
    // Links to sections of this page scroll in place instead of reloading.
    const a = t.closest<HTMLAnchorElement>('a[href]');
    if (!a) return;
    const u = new URL(a.href);
    const el = (u.host === location.host || u.host === 'liamogrady.dev') && u.hash ? document.getElementById(decodeURIComponent(u.hash.slice(1))) : null;
    if (!el || (u.pathname !== location.pathname && u.host === location.host)) return;
    e.preventDefault();
    go(el, 'start');
    if (narrow()) close();
  });

  return { open, close, ask, setMode };
}
