/**
 * Wire protocol for live presence (/api/live). Pure functions so they are testable without workerd.
 *
 * Client -> server (JSON text, <= 512 bytes, anything else is ignored):
 *   { t: "m", x, y, s }   pointer moved: x, y in [0, 1], s = section index 0-20
 *   { t: "n", n }         music note 0-23 (max 8 per second per socket)
 *   { t: "p" }            ping
 * Server -> client:
 *   { t: "welcome", id, here, peers: [{ id, c, x, y, s }] }   (+ observer: true beyond the cap)
 *   { t: "join", id, c } | { t: "leave", id } | { t: "m", id, x, y, s } | { t: "n", id, n } | { t: "p" }
 */

export const MAX_ACTIVE_PEERS = 48;
export const MAX_MESSAGE_BYTES = 512;
export const NOTES_PER_SECOND = 8;
export const MOVES_PER_SECOND = 30;
export const MAX_SECTION = 20;
export const MAX_NOTE = 23;

export type ClientMessage = { t: 'm'; x: number; y: number; s: number } | { t: 'n'; n: number } | { t: 'p' };

/** Serialized per socket with serializeAttachment (survives hibernation). Never holds an IP. */
export interface PeerAttachment {
  id: string;
  /** ISO country code from request.cf, or XX. */
  c: string;
  /** Join time (ms since epoch). */
  t: number;
  /** Observer (beyond the active-peer cap): receives only. */
  o?: 1;
  x?: number;
  y?: number;
  s?: number;
}

export interface PeerView {
  id: string;
  c: string;
  x: number | null;
  y: number | null;
  s: number | null;
}

const encoder = new TextEncoder();

function inUnitRange(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
}

function intInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

/** Parses one client frame; returns null for anything malformed, oversized or binary. */
export function parseClientMessage(raw: string | ArrayBuffer): ClientMessage | null {
  if (typeof raw !== 'string') return null;
  if (raw.length > MAX_MESSAGE_BYTES || encoder.encode(raw).byteLength > MAX_MESSAGE_BYTES) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
  const m = msg as Record<string, unknown>;
  switch (m.t) {
    case 'm':
      if (!inUnitRange(m.x) || !inUnitRange(m.y) || !intInRange(m.s, 0, MAX_SECTION)) return null;
      return { t: 'm', x: Math.round(m.x * 10_000) / 10_000, y: Math.round(m.y * 10_000) / 10_000, s: m.s };
    case 'n':
      return intInRange(m.n, 0, MAX_NOTE) ? { t: 'n', n: m.n } : null;
    case 'p':
      return { t: 'p' };
    default:
      return null;
  }
}

/** Sliding one-second window limiter. Returns whether this event is allowed and the trimmed history. */
export function allowInWindow(history: number[], now: number, limit: number, windowMs = 1000): { ok: boolean; history: number[] } {
  const recent = history.filter((ts) => now - ts < windowMs);
  if (recent.length >= limit) return { ok: false, history: recent };
  recent.push(now);
  return { ok: true, history: recent };
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** 8-character random id ([a-z0-9]). */
export function randomPeerId(random: Uint8Array = crypto.getRandomValues(new Uint8Array(8))): string {
  let id = '';
  for (let i = 0; i < 8; i++) id += ID_ALPHABET[(random[i] ?? 0) % ID_ALPHABET.length];
  return id;
}

export function normaliseCountry(c: unknown): string {
  return typeof c === 'string' && /^[A-Za-z]{2}$/.test(c) ? c.toUpperCase() : 'XX';
}

export function peerView(a: PeerAttachment): PeerView {
  return { id: a.id, c: a.c, x: a.x ?? null, y: a.y ?? null, s: a.s ?? null };
}

export function isAttachment(v: unknown): v is PeerAttachment {
  return !!v && typeof v === 'object' && typeof (v as PeerAttachment).id === 'string' && typeof (v as PeerAttachment).c === 'string';
}
