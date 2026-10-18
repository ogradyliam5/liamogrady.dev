/**
 * POST /api/contact: CV requests and hellos.
 *
 * liamogrady.dev's mail is Microsoft 365, so Cloudflare Email Routing (send_email) is not used:
 * it would replace the MX records. Delivery goes through an adapter chosen by CONTACT_DELIVERY:
 *   graph    Microsoft Graph sendMail from GRAPH_SENDER (client-credentials app, see docs/WORKER.md)
 *   webhook  POST JSON to CONTACT_WEBHOOK_URL (Power Automate / Logic Apps HTTP trigger)
 *   none     200 { ok: false, error: "not_configured", mailto } so the UI falls back to email
 */
import { z } from 'zod';
import type { Env } from './env';
import { allowedHostnames, clientIp, edgeInfo, isLocalHostname, json, LOCAL_HOSTS, originAllowed, rateLimited, readJson, SITE_HOSTS } from './http';
import { verifyTurnstile } from './turnstile';
import { cleanLine, cleanText, truncate } from './text';

export const DEFAULT_CONTACT_TO = 'ogradyliam5@gmail.com';
const MAX_BODY_BYTES = 16 * 1024;

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

const ContactSchema = z
  .strictObject({
    kind: z.enum(['cv', 'hello']),
    name: z.string().max(400).transform(cleanLine).pipe(z.string().min(1, 'Please add your name.').max(100, 'Name is too long.')),
    email: z.string().trim().max(200, 'Email is too long.').regex(EMAIL, 'Please use a valid email address.'),
    company: z.string().max(500).transform(cleanLine).pipe(z.string().max(120, 'Company is too long.')).optional(),
    message: z.string().max(6000).transform(cleanText).pipe(z.string().max(2000, 'Message is too long (2,000 characters max).')).optional(),
    website: z.string().max(500).optional(),
    turnstile: z.string().max(2048).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'hello' && !v.message) ctx.addIssue({ code: 'custom', path: ['message'], message: 'Please add a message.' });
  });

export type ContactRequest = z.output<typeof ContactSchema>;

export type ContactValidation =
  | { ok: true; value: ContactRequest }
  | { ok: false; error: 'spam' }
  | { ok: false; error: 'invalid'; field: string; message: string };

/** Validates a parsed JSON body. A filled honeypot (`website`) is reported as spam. */
export function validateContact(input: unknown): ContactValidation {
  if (input && typeof input === 'object' && 'website' in input) {
    const w = (input as { website?: unknown }).website;
    if (typeof w === 'string' ? w.trim() !== '' : w != null) return { ok: false, error: 'spam' };
  }
  const r = ContactSchema.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  const issue = r.error.issues[0];
  const field = issue?.path.length ? String(issue.path[0]) : 'body';
  const message = issue?.code === 'unrecognized_keys' ? 'Unexpected field.' : issue?.message ?? 'Invalid request.';
  return { ok: false, error: 'invalid', field, message };
}

export function contactSubject(c: Pick<ContactRequest, 'kind' | 'name'>): string {
  const name = truncate(cleanLine(c.name), 80);
  return c.kind === 'cv' ? `[liamogrady.dev] CV request from ${name}` : `[liamogrady.dev] Hello from ${name}`;
}

export function contactBody(c: ContactRequest, meta: { country: string; receivedAt: string }): string {
  return [
    c.kind === 'cv' ? 'New CV request via liamogrady.dev' : 'New message via liamogrady.dev',
    '',
    `Name:     ${c.name}`,
    `Email:    ${c.email}`,
    `Company:  ${c.company || '-'}`,
    `Country:  ${meta.country}`,
    `Received: ${meta.receivedAt}`,
    '',
    'Message:',
    c.message || '(none)',
    '',
    '-- Reply to this email to answer the sender directly.',
  ].join('\n');
}

/** Prefilled mailto: link for the UI fallback. */
export function mailtoLink(to: string, c?: Partial<ContactRequest>): string {
  const kind = c?.kind ?? 'hello';
  const subject = c?.name ? contactSubject({ kind, name: c.name }) : kind === 'cv' ? '[liamogrady.dev] CV request' : '[liamogrady.dev] Hello';
  const body = [c?.message ? truncate(c.message, 1200) : '', c?.company ? `\n\nCompany: ${c.company}` : ''].join('').trim();
  const q = [`subject=${encodeURIComponent(subject)}`, body ? `body=${encodeURIComponent(body)}` : ''].filter(Boolean).join('&');
  return `mailto:${to}?${q}`;
}

export class DeliveryError extends Error {
  constructor(
    readonly code: 'misconfigured' | 'delivery_failed',
    message: string,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

// Microsoft Graph app-only token, cached per isolate until shortly before expiry.
let graphToken: { key: string; token: string; expiresAt: number } | null = null;

export function resetGraphTokenCache(): void {
  graphToken = null;
}

async function getGraphToken(env: Env, doFetch: Fetch): Promise<string> {
  const { GRAPH_TENANT_ID: tenant, GRAPH_CLIENT_ID: clientId, GRAPH_CLIENT_SECRET: secret } = env;
  if (!tenant || !clientId || !secret) throw new DeliveryError('misconfigured', 'GRAPH_TENANT_ID, GRAPH_CLIENT_ID and GRAPH_CLIENT_SECRET are required');
  const key = `${tenant}:${clientId}`;
  if (graphToken && graphToken.key === key && graphToken.expiresAt - 60_000 > Date.now()) return graphToken.token;
  const res = await doFetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }).toString(),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new DeliveryError('delivery_failed', `token endpoint returned ${res.status}`);
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new DeliveryError('delivery_failed', 'token endpoint returned no access_token');
  graphToken = { key, token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return data.access_token;
}

export async function deliverViaGraph(env: Env, c: ContactRequest, meta: { country: string; receivedAt: string }, doFetch: Fetch = fetch): Promise<void> {
  if (!env.GRAPH_SENDER) throw new DeliveryError('misconfigured', 'GRAPH_SENDER is required');
  const token = await getGraphToken(env, doFetch);
  const res = await doFetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.GRAPH_SENDER)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: contactSubject(c),
        body: { contentType: 'Text', content: contactBody(c, meta) },
        toRecipients: [{ emailAddress: { address: env.CONTACT_TO || DEFAULT_CONTACT_TO } }],
        replyTo: [{ emailAddress: { address: c.email, name: c.name } }],
      },
      saveToSentItems: false,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401) graphToken = null;
  if (!res.ok) throw new DeliveryError('delivery_failed', `sendMail returned ${res.status}`);
}

export async function deliverViaWebhook(env: Env, c: ContactRequest, meta: { country: string; receivedAt: string }, doFetch: Fetch = fetch): Promise<void> {
  if (!env.CONTACT_WEBHOOK_URL) throw new DeliveryError('misconfigured', 'CONTACT_WEBHOOK_URL is required');
  const res = await doFetch(env.CONTACT_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: c.kind,
      name: c.name,
      email: c.email,
      company: c.company ?? null,
      message: c.message ?? null,
      subject: contactSubject(c),
      to: env.CONTACT_TO || DEFAULT_CONTACT_TO,
      country: meta.country,
      receivedAt: meta.receivedAt,
      source: 'liamogrady.dev',
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new DeliveryError('delivery_failed', `webhook returned ${res.status}`);
}

export function turnstileHostnames(env: Env, requestHostname: string): string[] {
  const hosts = allowedHostnames(env, requestHostname).filter((h) => !LOCAL_HOSTS.includes(h));
  return isLocalHostname(requestHostname) ? [...hosts, ...LOCAL_HOSTS] : hosts.length ? hosts : SITE_HOSTS;
}

export async function handleContact(request: Request, env: Env, doFetch: Fetch = fetch): Promise<Response> {
  const to = env.CONTACT_TO || DEFAULT_CONTACT_TO;
  if (!originAllowed(request, env)) return json({ ok: false, error: 'forbidden_origin' }, { status: 403 });

  const body = await readJson(request, MAX_BODY_BYTES);
  if (!body.ok) return json({ ok: false, error: body.error }, { status: body.status });

  const ip = clientIp(request);
  if (await rateLimited(env.RL_CONTACT, `contact:${ip}`)) {
    return json({ ok: false, error: 'rate_limited', mailto: mailtoLink(to) }, { status: 429, headers: { 'Retry-After': '60' } });
  }

  const v = validateContact(body.value);
  // Bots that fill the hidden field get a quiet success and nothing is sent.
  if (!v.ok && v.error === 'spam') return json({ ok: true });
  if (!v.ok) return json({ ok: false, error: 'invalid', field: v.field, message: v.message }, { status: 400 });
  const c = v.value;

  if (env.TURNSTILE_SECRET) {
    const hostname = new URL(request.url).hostname;
    const check = await verifyTurnstile({
      secret: env.TURNSTILE_SECRET,
      token: c.turnstile ?? '',
      ip,
      action: 'contact',
      hostnames: turnstileHostnames(env, hostname),
      fetcher: doFetch,
    });
    if (!check.ok) return json({ ok: false, error: 'turnstile_failed' }, { status: 403 });
  }

  const meta = { country: edgeInfo(request, env).country ?? 'unknown', receivedAt: new Date().toISOString() };
  const mode = (env.CONTACT_DELIVERY || 'none').toLowerCase();
  try {
    if (mode === 'graph') await deliverViaGraph(env, c, meta, doFetch);
    else if (mode === 'webhook') await deliverViaWebhook(env, c, meta, doFetch);
    else return json({ ok: false, error: 'not_configured', mailto: mailtoLink(to, c) });
  } catch (err) {
    const code = err instanceof DeliveryError ? err.code : 'delivery_failed';
    console.error(`contact delivery (${mode}) failed: ${err instanceof Error ? err.message : String(err)}`);
    return json({ ok: false, error: code, mailto: mailtoLink(to, c) }, { status: code === 'misconfigured' ? 503 : 502 });
  }
  return json({ ok: true });
}
