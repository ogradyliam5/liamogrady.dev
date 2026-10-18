/** Cloudflare Turnstile server-side verification (siteverify). */

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface TurnstileCheck {
  secret: string;
  token: string;
  ip?: string;
  /** Widget action the client must have rendered with (e.g. "contact", "agent"). */
  action: string;
  /** Hostnames the token may have been issued on. */
  hostnames: string[];
  fetcher?: typeof fetch;
}

export type TurnstileResult = { ok: true } | { ok: false; reason: string };

export async function verifyTurnstile(check: TurnstileCheck): Promise<TurnstileResult> {
  if (!check.token || check.token.length > 2048) return { ok: false, reason: 'missing-token' };
  const doFetch = check.fetcher ?? fetch;
  let data: { success?: boolean; hostname?: string; action?: string; 'error-codes'?: string[] };
  try {
    const res = await doFetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: check.secret,
        response: check.token,
        ...(check.ip && check.ip !== 'local' ? { remoteip: check.ip } : {}),
        idempotency_key: crypto.randomUUID(),
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, reason: `siteverify-http-${res.status}` };
    data = (await res.json()) as typeof data;
  } catch {
    return { ok: false, reason: 'siteverify-unreachable' };
  }
  if (!data.success) return { ok: false, reason: (data['error-codes'] ?? ['failed']).join(',') };
  if (!data.hostname || !check.hostnames.includes(data.hostname.toLowerCase())) return { ok: false, reason: 'hostname-mismatch' };
  if (data.action !== check.action) return { ok: false, reason: 'action-mismatch' };
  return { ok: true };
}
