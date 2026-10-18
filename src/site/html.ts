/**
 * Tiny, safe HTML templating. Interpolations are escaped by default;
 * wrap trusted markup in raw(). Arrays are joined, null/false/undefined render nothing.
 */

const RAW = Symbol('raw');

export type Raw = { [RAW]: true; value: string; toString(): string };

export function raw(value: string): Raw {
  return { [RAW]: true, value, toString: () => value };
}

export function isRaw(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && (v as Raw)[RAW] === true;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ESC[c]!);
}

type Value = string | number | boolean | null | undefined | Raw | Value[];

function render(v: Value): string {
  if (v === null || v === undefined || v === false || v === true) return '';
  if (Array.isArray(v)) return v.map(render).join('');
  if (isRaw(v)) return v.value;
  return esc(v);
}

export function html(strings: TemplateStringsArray, ...values: Value[]): Raw {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) out += render(values[i]!) + (strings[i + 1] ?? '');
  return raw(out);
}

/** Attribute helper: attrs({ href, 'aria-label': x, hidden: false }) */
export function attrs(map: Record<string, string | number | boolean | null | undefined>): Raw {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(map)) {
    if (v === false || v === null || v === undefined) continue;
    parts.push(v === true ? k : `${k}="${esc(v)}"`);
  }
  return raw(parts.length ? ' ' + parts.join(' ') : '');
}

/**
 * Collapse whitespace runs to a single space (never removes it entirely, so inline
 * spacing survives). <pre>, <textarea>, <script> and <style> blocks are left untouched.
 */
export function minifyHtml(s: string): string {
  const keep: string[] = [];
  const protectedSrc = s.replace(/<(pre|textarea|script|style)\b[\s\S]*?<\/\1>/gi, (m) => {
    keep.push(m);
    return `\u0000${keep.length - 1}\u0000`;
  });
  const squeezed = protectedSrc
    .replace(/<!--(?!\s*\[)[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return squeezed.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[Number(i)]!);
}
