/** Small HTTP helpers shared by every route: JSON, standard headers, hosts, client info, rate limits. */
import type { Env, RateLimiter } from './env';

export const SITE_HOSTS = ['liamogrady.dev', 'www.liamogrady.dev', 'dev.liamogrady.dev'];
export const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/**
 * Matches the live and dev Workers' own workers.dev hosts and their preview URLs:
 * liamogrady-dev.<sub>.workers.dev, liamogrady-dev-dev.<sub>.workers.dev, <prefix>-liamogrady-dev[-dev].<sub>.workers.dev.
 */
const OWN_WORKERS_DEV = /^(?:[a-z0-9-]+-)?liamogrady-dev(?:-dev)?\.[a-z0-9-]+\.workers\.dev$/i;

export function now(): number {
  return performance.now();
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), { ...init, headers });
}

export interface FinalizeOptions {
  /** Cache-Control for Worker-generated responses (default no-store). */
  cache?: string;
  /** Add the colo to Server-Timing. */
  colo?: string;
  /** Leave the response's own headers alone (static assets keep their _headers rules). */
  passthrough?: boolean;
  /** Extra Vary header value. */
  vary?: string;
}

/**
 * Stamps the standard headers on a Worker-generated response: nosniff, referrer policy,
 * Cache-Control (no-store unless told otherwise) and Server-Timing with the Worker time.
 * Workers' clocks only advance on I/O, so `worker;dur` measures time spent waiting on
 * bindings and subrequests, not CPU.
 */
export function finalize(res: Response, startedAt: number, opts: FinalizeOptions = {}): Response {
  if (res.status === 101) return res; // WebSocket upgrades go back untouched
  const out = new Response(res.body, res);
  const h = out.headers;
  if (!opts.passthrough) {
    h.set('X-Content-Type-Options', 'nosniff');
    h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    h.set('Cache-Control', opts.cache ?? 'no-store');
  }
  if (opts.vary) h.append('Vary', opts.vary);
  const timing = [`worker;dur=${Math.max(0, now() - startedAt).toFixed(1)}`];
  if (opts.colo) timing.push(`colo;desc="${opts.colo.replace(/[^A-Za-z0-9 _-]/g, '')}"`);
  h.append('Server-Timing', timing.join(', '));
  return out;
}

export function isOwnWorkersDev(hostname: string): boolean {
  return OWN_WORKERS_DEV.test(hostname);
}

/** Hostnames this Worker answers for: the site, localhost, ALLOWED_HOSTS and its own workers.dev host. */
export function allowedHostnames(env: Pick<Env, 'ALLOWED_HOSTS'>, requestHostname?: string): string[] {
  const extra = (env.ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const list = [...SITE_HOSTS, ...LOCAL_HOSTS, ...extra];
  if (requestHostname && isOwnWorkersDev(requestHostname)) list.push(requestHostname.toLowerCase());
  return [...new Set(list)];
}

export function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTS.includes(hostname.toLowerCase());
}

/** Browsers send Origin on cross-site requests; reject other sites. Non-browser clients (no Origin) pass. */
export function originAllowed(request: Request, env: Pick<Env, 'ALLOWED_HOSTS'>): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  const self = new URL(request.url);
  if (o.host === self.host) return true;
  return allowedHostnames(env, self.hostname).includes(o.hostname.toLowerCase());
}

export function clientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Real-IP') ??
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    'local'
  );
}

export interface EdgeInfo {
  colo: string;
  city: string | null;
  country: string | null;
  httpProtocol: string | null;
  tlsVersion: string | null;
  rttMs: number | null;
}

/** request.cf facts, with the scripts/dev.ts stand-in (env.__cfLocal) or "LOCAL" when absent. */
export function edgeInfo(request: Request, env: Pick<Env, '__cfLocal'>): EdgeInfo {
  const cf = (request as unknown as { cf?: Record<string, unknown> }).cf;
  const local = env.__cfLocal;
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    colo: str(cf?.colo) ?? local?.colo ?? 'LOCAL',
    city: str(cf?.city) ?? local?.city ?? null,
    country: str(cf?.country) ?? local?.country ?? null,
    httpProtocol: str(cf?.httpProtocol),
    tlsVersion: str(cf?.tlsVersion),
    rttMs: num(cf?.clientTcpRtt),
  };
}

/** True when the request should be rejected. Missing binding (Bun dev, tests) or limiter errors fail open. */
export async function rateLimited(limiter: RateLimiter | undefined, key: string): Promise<boolean> {
  if (!limiter) return false;
  try {
    const { success } = await limiter.limit({ key });
    return !success;
  } catch {
    return false;
  }
}

/** Reads a JSON body with a hard size cap and a Content-Type check (413 / 415 / 400 on failure). */
export async function readJson(request: Request, maxBytes: number): Promise<{ ok: true; value: unknown } | { ok: false; status: number; error: string }> {
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > maxBytes) return { ok: false, status: 413, error: 'too_large' };
  const type = request.headers.get('Content-Type') ?? '';
  if (!/^application\/json\b/i.test(type)) return { ok: false, status: 415, error: 'expected_json' };
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) return { ok: false, status: 413, error: 'too_large' };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: 'bad_json' };
  }
}
