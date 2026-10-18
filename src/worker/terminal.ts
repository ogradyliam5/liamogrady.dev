/**
 * The terminal CV: `curl liamogrady.dev` gets an ANSI-coloured, ≤80-column CV built from
 * content/profile.ts (via src/shared/knowledge.ts). `?color=0` or `?plain` returns it without colour.
 */
import { SITE, capabilities, certifications, experience, fmtMonth, now, person, publishedProjects, roleSpan } from '../shared/knowledge';

export const MAX_WIDTH = 80;
/** Content width: stays clear of column 80, which auto-wraps in some terminals. */
const W = 78;

const S = {
  cyan: '38;5;80',
  gold: '38;5;221',
  goldBold: '1;38;5;221',
  white: '1;97',
  dim: '2',
};

/** curl / wget / HTTPie / xh / PowerShell, unless they explicitly ask for HTML. */
export function isTerminalClient(userAgent: string | null | undefined, accept: string | null | undefined): boolean {
  if ((accept ?? '').toLowerCase().includes('text/html')) return false;
  const ua = (userAgent ?? '').trim();
  return /^(curl|wget2?|httpie|xh)(\/|\s|$)/i.test(ua) || ua.includes('PowerShell/');
}

/** `?color=0|false|no|off|never`, `?plain` or `?nocolor` turn colour off (NO_COLOR style). */
export function wantsColor(url: URL): boolean {
  const q = url.searchParams;
  if (q.has('plain') || q.has('nocolor') || q.has('no_color') || q.has('no-color')) return false;
  const c = q.get('color') ?? q.get('colour');
  return !(c !== null && /^(0|false|no|off|never)$/i.test(c));
}

const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI, '');
}

export function visibleWidth(s: string): number {
  return [...stripAnsi(s)].length;
}

const len = (s: string) => [...s].length;

function paint(text: string, sgr: string | undefined, color: boolean): string {
  return color && sgr && text ? `\x1b[${sgr}m${text}\x1b[0m` : text;
}

/** A run of text with an optional SGR style. `pre` keeps it as one unbreakable token (column padding). */
export type Segment = { t: string; s?: string; pre?: boolean };

/**
 * Greedy word wrap over styled segments. Each word keeps its style, every styled run is closed
 * on the line it starts (no colour bleeding), and words longer than a line are hard-broken.
 */
export function wrapSegments(segments: Segment[], width: number, indent = '', hang = indent, color = true): string[] {
  const words: { w: string; s?: string; space: boolean }[] = [];
  let pendingSpace = false;
  for (const seg of segments) {
    if (seg.pre) {
      if (seg.t) words.push({ w: seg.t, s: seg.s, space: pendingSpace && words.length > 0 });
      pendingSpace = false;
      continue;
    }
    for (const part of seg.t.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        pendingSpace = true;
        continue;
      }
      words.push({ w: part, s: seg.s, space: pendingSpace && words.length > 0 });
      pendingSpace = false;
    }
  }
  const lines: string[] = [];
  let prefix = indent;
  let runs: { s?: string; text: string }[] = [];
  let used = 0;
  const flush = () => {
    lines.push(prefix + runs.map((r) => paint(r.text, r.s, color)).join(''));
    prefix = hang;
    runs = [];
    used = 0;
  };
  const append = (text: string, s: string | undefined) => {
    const last = runs[runs.length - 1];
    if (last && last.s === s) last.text += text;
    else runs.push({ s, text });
    used += len(text);
  };
  for (const { w, s, space } of words) {
    const gap = used > 0 && space ? 1 : 0;
    if (used > 0 && len(prefix) + used + gap + len(w) > width) flush();
    let chars = [...w];
    while (chars.length) {
      const g = used > 0 && space ? 1 : 0;
      const room = width - len(prefix) - used - g;
      if (room <= 0) {
        flush();
        continue;
      }
      if (g) append(' ', runs[runs.length - 1]?.s === s ? s : undefined);
      append(chars.slice(0, room).join(''), s);
      chars = chars.slice(room);
      if (chars.length) flush();
    }
  }
  if (runs.length || lines.length === 0) flush();
  return lines.map((l) => l.replace(/\s+$/, ''));
}

// "LOG" in block letters (Liam O'Grady), with the apostrophe as a gold accent.
const BANNER = {
  L: ['██     ', '██     ', '██     ', '██     ', '███████'],
  O: [' █████ ', '██   ██', '██   ██', '██   ██', ' █████ '],
  A: ['██', '▀▀', '  ', '  ', '  '],
  G: [' ██████', '██     ', '██  ███', '██   ██', ' ██████'],
};

export interface TerminalCvOptions {
  siteUrl?: string;
  colo: string;
  elapsedMs: number;
  color?: boolean;
}

export function renderTerminalCv(opts: TerminalCvOptions): string {
  const color = opts.color ?? true;
  const site = (opts.siteUrl || SITE).replace(/\/+$/, '');
  const host = site.replace(/^https?:\/\//, '');
  const p = (t: string, s?: string) => paint(t, s, color);
  const out: string[] = [];
  const para = (segs: Segment[], indent = '  ', hang = indent) => out.push(...wrapSegments(segs, W, indent, hang, color));
  const heading = (label: string, note = '') => {
    const right = note ? ` ${note}` : '';
    const rule = Math.max(3, W - len(label) - 1 - len(right));
    out.push('', `${p(label, S.goldBold)} ${p('─'.repeat(rule), S.dim)}${right ? p(right, S.dim) : ''}`);
  };

  // Banner + identity block.
  const side = [
    '',
    p(person.name, S.white),
    p(`${person.role} · ${person.employer}`, S.cyan),
    p(`${person.location} · from ${person.origin}`, S.dim),
    p(host, S.gold),
  ];
  out.push('');
  for (let i = 0; i < 5; i++) {
    const art = `${p(`${BANNER.L[i]} ${BANNER.O[i]}`, S.cyan)} ${p(BANNER.A[i] ?? '', S.gold)} ${p(BANNER.G[i] ?? '', S.cyan)}`;
    const extra = side[i] ? `    ${side[i]}` : '';
    out.push(`  ${art}${extra}`.replace(/\s+$/, ''));
  }
  out.push('');
  para([{ t: person.oneLiner }]);

  heading('NOW', `updated ${fmtMonth(now.updated)}`);
  for (const item of now.items) para([{ t: '•', s: S.gold }, { t: ` ${item}` }], '  ', '    ');

  heading('EXPERIENCE');
  experience.forEach((r, i) => {
    if (i > 0) out.push('');
    para([{ t: r.title, s: S.white }, { t: ' · ' }, { t: `${r.company}${r.parent ? ` (${r.parent})` : ''}`, s: S.cyan }], '  ', '    ');
    para([{ t: `${roleSpan(r)} · ${r.place}`, s: S.dim }], '  ', '    ');
    if (r.steps?.length) {
      const tw = Math.max(...r.steps.map((s) => len(s.title)));
      for (const s of r.steps) {
        const dates = `${fmtMonth(s.start)} – ${fmtMonth(s.end)}`;
        if (6 + tw + 2 + len(dates) <= W) out.push(`    ${p('↳', S.gold)} ${s.title.padEnd(tw)}  ${p(dates, S.dim)}`);
        else para([{ t: '↳', s: S.gold }, { t: ` ${s.title} ` }, { t: dates, s: S.dim }], '    ', '      ');
      }
    }
  });

  heading('CAPABILITIES');
  const caps = capabilities.map((c) => c.title);
  const half = Math.ceil(caps.length / 2);
  const left = caps.slice(0, half);
  const right = caps.slice(half);
  const lw = Math.max(0, ...left.map(len));
  const rw = Math.max(0, ...right.map(len));
  if (2 + 2 + lw + 3 + 2 + rw <= W) {
    left.forEach((l, i) => {
      const r = right[i];
      out.push(`  ${p('•', S.gold)} ${r ? l.padEnd(lw) : l}${r ? `   ${p('•', S.gold)} ${r}` : ''}`);
    });
  } else {
    for (const c of caps) para([{ t: '•', s: S.gold }, { t: ` ${c}` }], '  ', '    ');
  }

  heading('PROJECTS');
  publishedProjects.forEach((pr, i) => {
    if (i > 0) out.push('');
    para([{ t: pr.name, s: S.white }, { t: ` · ${pr.year}`, s: S.dim }], '  ', '    ');
    para([{ t: pr.tagline }], '    ');
    const url = pr.live ?? pr.repo;
    if (url) para([{ t: url, s: S.cyan }], '    ');
  });

  heading('CERTIFICATIONS', 'Microsoft');
  const sw = Math.max(...certifications.map((c) => len(c.short)));
  for (const c of certifications) {
    const mark = p(c.level === 'Expert' ? '◆' : '◇', S.gold);
    if (4 + sw + 2 + len(c.level) <= W) out.push(`  ${mark} ${c.short.padEnd(sw)}  ${p(c.level, S.dim)}`);
    else para([{ t: c.level === 'Expert' ? '◆' : '◇', s: S.gold }, { t: ` ${c.short} ` }, { t: c.level, s: S.dim }], '  ', '    ');
  }
  para([{ t: 'verify:', s: S.dim }, { t: ` ${site}/#credentials`, s: S.cyan }], '    ');

  heading('CONTACT');
  const contact: [string, string, string?][] = [
    ['email', person.email],
    ['linkedin', person.links.linkedin],
    ['github', person.links.github],
    ['full CV', `${site}/#contact`, '(client detail on request)'],
  ];
  for (const [label, value, note] of contact) {
    para([{ t: label.padEnd(10), s: S.dim, pre: true }, { t: value, s: S.cyan }, ...(note ? [{ t: ` ${note}`, s: S.dim }] : [])], '  ', '            ');
  }

  out.push('', p('─'.repeat(W), S.dim));
  para([{ t: 'agents:', s: S.gold }, { t: ` claude mcp add --transport http liam ${site}/mcp` }], '  ', '    ');
  const ms = opts.elapsedMs < 1 ? '<1' : String(Math.round(opts.elapsedMs));
  para([{ t: `served from ${opts.colo || 'LOCAL'} in ${ms} ms`, s: S.dim }]);
  out.push('');
  return out.join('\n');
}

export function terminalResponse(request: Request, opts: TerminalCvOptions): Response {
  const body = request.method === 'HEAD' ? null : renderTerminalCv(opts);
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      Vary: 'User-Agent, Accept',
    },
  });
}
