import { beforeEach, describe, expect, it } from 'vitest';
import { contactSubject, handleContact, mailtoLink, resetGraphTokenCache, validateContact } from '../../src/worker/contact';
import type { Env } from '../../src/worker/env';

const valid = { kind: 'cv', name: 'Ada Lovelace', email: 'ada@example.com', company: 'Analytical Engines', message: 'Could I see the full CV?' };

type Call = { url: string; init: RequestInit };
function fakeFetch(responder: (url: string, init: RequestInit) => Response) {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return responder(url, init);
  }) as typeof fetch;
  return { fn, calls };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://liamogrady.dev/api/contact', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('validateContact', () => {
  it('accepts a CV request without a message', () => {
    const r = validateContact({ kind: 'cv', name: 'Ada', email: 'ada@example.com' });
    expect(r.ok).toBe(true);
  });

  it('requires a message for hello', () => {
    expect(validateContact({ kind: 'hello', name: 'Ada', email: 'ada@example.com' })).toMatchObject({ ok: false, field: 'message' });
    expect(validateContact({ kind: 'hello', name: 'Ada', email: 'ada@example.com', message: 'Hi Liam' }).ok).toBe(true);
  });

  it('treats a filled honeypot as spam and an empty one as fine', () => {
    expect(validateContact({ ...valid, website: 'http://spam.example' })).toEqual({ ok: false, error: 'spam' });
    expect(validateContact({ ...valid, website: '' }).ok).toBe(true);
  });

  it.each(['not-an-email', 'ada@example', 'ada @example.com', 'ada@example.com\r\nBcc: x@y.z', '<script>@x.com', 'a@-bad.com'])(
    'rejects the email %j',
    (email) => {
      expect(validateContact({ ...valid, email })).toMatchObject({ ok: false, field: 'email' });
    },
  );

  it('enforces the length limits', () => {
    expect(validateContact({ ...valid, name: 'x'.repeat(101) })).toMatchObject({ ok: false, field: 'name' });
    expect(validateContact({ ...valid, name: 'x'.repeat(100) }).ok).toBe(true);
    expect(validateContact({ ...valid, email: `${'a'.repeat(190)}@example.com` })).toMatchObject({ ok: false, field: 'email' });
    expect(validateContact({ ...valid, company: 'c'.repeat(121) })).toMatchObject({ ok: false, field: 'company' });
    expect(validateContact({ ...valid, message: 'm'.repeat(2001) })).toMatchObject({ ok: false, field: 'message' });
    expect(validateContact({ ...valid, message: 'm'.repeat(2000) }).ok).toBe(true);
    expect(validateContact({ ...valid, name: '' })).toMatchObject({ ok: false, field: 'name' });
  });

  it('cleans names and messages and rejects unknown fields or kinds', () => {
    const r = validateContact({ ...valid, name: '  Ada\u0000  <b>Lovelace</b>\n', message: 'Line one\r\n\r\n\r\n\r\nLine two\u202E' });
    expect(r.ok && r.value.name).toBe('Ada Lovelace');
    expect(r.ok && r.value.message).toBe('Line one\n\nLine two');
    expect(validateContact({ ...valid, admin: true })).toMatchObject({ ok: false, error: 'invalid' });
    expect(validateContact({ ...valid, kind: 'job' })).toMatchObject({ ok: false, field: 'kind' });
    expect(validateContact('nope')).toMatchObject({ ok: false });
  });

  it('builds subjects and a prefilled mailto', () => {
    expect(contactSubject({ kind: 'cv', name: 'Ada' })).toBe('[liamogrady.dev] CV request from Ada');
    expect(contactSubject({ kind: 'hello', name: 'Ada' })).toBe('[liamogrady.dev] Hello from Ada');
    const link = mailtoLink('ogradyliam5@gmail.com', { kind: 'hello', name: 'Ada', message: 'Hi & bye?' });
    expect(link.startsWith('mailto:ogradyliam5@gmail.com?subject=')).toBe(true);
    expect(decodeURIComponent(link)).toContain('body=Hi & bye?');
  });
});

describe('handleContact', () => {
  beforeEach(() => resetGraphTokenCache());

  it('answers 200 not_configured with a mailto link when delivery is "none"', async () => {
    const res = await handleContact(post(valid), { CONTACT_DELIVERY: 'none' } as Env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; error: string; mailto: string };
    expect(body).toMatchObject({ ok: false, error: 'not_configured' });
    expect(decodeURIComponent(body.mailto)).toContain('mailto:ogradyliam5@gmail.com?subject=[liamogrady.dev] CV request from Ada Lovelace');
  });

  it('quietly accepts honeypot submissions without delivering anything', async () => {
    const f = fakeFetch(() => new Response('ok'));
    const res = await handleContact(post({ ...valid, website: 'x' }), { CONTACT_DELIVERY: 'webhook', CONTACT_WEBHOOK_URL: 'https://hook.example/run' } as Env, f.fn);
    expect(await res.json()).toEqual({ ok: true });
    expect(f.calls).toHaveLength(0);
  });

  it('posts to the webhook with country and timestamp', async () => {
    const f = fakeFetch(() => new Response(null, { status: 202 }));
    const env = { CONTACT_DELIVERY: 'webhook', CONTACT_WEBHOOK_URL: 'https://hook.example/run?sig=secret', __cfLocal: { country: 'IE' } } as Env;
    const res = await handleContact(post(valid), env, f.fn);
    expect(await res.json()).toEqual({ ok: true });
    expect(f.calls).toHaveLength(1);
    const sent = JSON.parse(String(f.calls[0]!.init.body));
    expect(sent).toMatchObject({ kind: 'cv', name: 'Ada Lovelace', email: 'ada@example.com', country: 'IE', source: 'liamogrady.dev' });
    expect(Date.parse(sent.receivedAt)).not.toBeNaN();
  });

  it('reports webhook failures as 502 with a mailto fallback', async () => {
    const f = fakeFetch(() => new Response('nope', { status: 500 }));
    const res = await handleContact(post(valid), { CONTACT_DELIVERY: 'webhook', CONTACT_WEBHOOK_URL: 'https://hook.example/run' } as Env, f.fn);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, error: 'delivery_failed' });
  });

  it('sends through Microsoft Graph and caches the app token', async () => {
    const f = fakeFetch((url) =>
      url.includes('login.microsoftonline.com')
        ? Response.json({ access_token: 'tok-1', expires_in: 3600 })
        : new Response(null, { status: 202 }),
    );
    const env = {
      CONTACT_DELIVERY: 'graph',
      GRAPH_TENANT_ID: 'tenant-id',
      GRAPH_CLIENT_ID: 'client-id',
      GRAPH_CLIENT_SECRET: 'client-secret',
      GRAPH_SENDER: 'hello@liamogrady.dev',
    } as Env;
    expect(await (await handleContact(post(valid), env, f.fn)).json()).toEqual({ ok: true });
    expect(await (await handleContact(post({ ...valid, kind: 'hello' }), env, f.fn)).json()).toEqual({ ok: true });
    const tokenCalls = f.calls.filter((c) => c.url.includes('/oauth2/v2.0/token'));
    const sendCalls = f.calls.filter((c) => c.url.includes('/sendMail'));
    expect(tokenCalls).toHaveLength(1);
    expect(sendCalls).toHaveLength(2);
    expect(sendCalls[0]!.url).toBe('https://graph.microsoft.com/v1.0/users/hello%40liamogrady.dev/sendMail');
    expect((sendCalls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1');
    const mail = JSON.parse(String(sendCalls[0]!.init.body));
    expect(mail.message.subject).toBe('[liamogrady.dev] CV request from Ada Lovelace');
    expect(mail.message.toRecipients[0].emailAddress.address).toBe('ogradyliam5@gmail.com');
    expect(mail.message.replyTo[0].emailAddress.address).toBe('ada@example.com');
    expect(mail.message.body.content).toContain('Company:  Analytical Engines');
    expect(JSON.parse(String(sendCalls[1]!.init.body)).message.subject).toBe('[liamogrady.dev] Hello from Ada Lovelace');
  });

  it('reports a half-configured Graph adapter as 503 misconfigured', async () => {
    const res = await handleContact(post(valid), { CONTACT_DELIVERY: 'graph', GRAPH_SENDER: 'hello@liamogrady.dev' } as Env, fakeFetch(() => new Response()).fn);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: 'misconfigured' });
  });

  it('rate limits per IP', async () => {
    const keys: string[] = [];
    const env = { RL_CONTACT: { limit: async ({ key }: { key: string }) => (keys.push(key), { success: false }) } } as Env;
    const res = await handleContact(post(valid), env);
    expect(res.status).toBe(429);
    expect(keys).toEqual(['contact:203.0.113.9']);
  });

  it('verifies Turnstile when a secret is configured', async () => {
    const siteverify = (hostname: string, action: string) =>
      fakeFetch((url) => (url.includes('siteverify') ? Response.json({ success: true, hostname, action }) : new Response(null, { status: 202 })));
    const env = { TURNSTILE_SECRET: 'secret', CONTACT_DELIVERY: 'webhook', CONTACT_WEBHOOK_URL: 'https://hook.example/run' } as Env;

    const missing = await handleContact(post(valid), env, siteverify('liamogrady.dev', 'contact').fn);
    expect(missing.status).toBe(403);

    const wrongHost = await handleContact(post({ ...valid, turnstile: 'tok' }), env, siteverify('evil.example', 'contact').fn);
    expect(wrongHost.status).toBe(403);

    const wrongAction = await handleContact(post({ ...valid, turnstile: 'tok' }), env, siteverify('liamogrady.dev', 'login').fn);
    expect(wrongAction.status).toBe(403);

    const good = siteverify('www.liamogrady.dev', 'contact');
    const ok = await handleContact(post({ ...valid, turnstile: 'tok' }), env, good.fn);
    expect(await ok.json()).toEqual({ ok: true });
    const verify = JSON.parse(String(good.calls[0]!.init.body));
    expect(verify).toMatchObject({ secret: 'secret', response: 'tok', remoteip: '203.0.113.9' });
    expect(typeof verify.idempotency_key).toBe('string');
  });

  it('rejects other origins, non-JSON and bad JSON', async () => {
    expect((await handleContact(post(valid, { origin: 'https://evil.example' }), {} as Env)).status).toBe(403);
    expect((await handleContact(post(valid, { origin: 'https://www.liamogrady.dev' }), {} as Env)).status).toBe(200);
    expect((await handleContact(post(valid, { 'content-type': 'text/plain' }), {} as Env)).status).toBe(415);
    expect((await handleContact(post('{"kind":'), {} as Env)).status).toBe(400);
  });
});
