/** Text hardening for anything a visitor (or a model) sends us. */

// C0/C1 controls except \t and \n, plus zero-width and bidi-override characters.
const CONTROL_KEEP_NL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
const CONTROL_ALL = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/** Removes control characters. Newlines (normalised to \n) and tabs survive when keepNewlines is true. */
export function stripControl(input: string, keepNewlines = true): string {
  const s = input.replace(/\r\n?/g, '\n');
  return keepNewlines ? s.replace(CONTROL_KEEP_NL, '') : s.replace(CONTROL_ALL, ' ');
}

/** Collapses runs of horizontal whitespace, trims lines and keeps at most one blank line in a row. */
export function collapseWhitespace(s: string): string {
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t\u00A0\u2000-\u200A\u202F\u205F\u3000]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Drops HTML tags and comments so visitor text is never echoed back as markup. */
export function stripHtml(s: string): string {
  return s.replace(/<!--[\s\S]*?-->/g, '').replace(/<\/?[a-z!][^<>]*>/gi, '');
}

/** Multi-line visitor text: no controls, no tags, tidy whitespace. */
export function cleanText(s: string): string {
  return collapseWhitespace(stripHtml(stripControl(s)));
}

/** Single-line visitor text (names, subjects). */
export function cleanLine(s: string): string {
  return stripHtml(stripControl(s, false)).replace(/\s+/g, ' ').trim();
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

/** First sentence of a block of text (or the first `max` characters). */
export function firstSentence(s: string, max = 180): string {
  const m = s.match(/^.+?[.!?](?=\s|$)/);
  return truncate((m ? m[0] : s).trim(), max);
}
