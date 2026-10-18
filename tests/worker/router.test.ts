import { describe, expect, it } from 'vitest';
import worker from '../../src/worker/index';
import type { Env } from '../../src/worker/env';

const CSP = "default-src 'self'";
const assets = {
  fetch: async (input: Request | string) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    return new Response(url.pathname === '/' ? '<!doctype html><title>Liam</title>' : 'Not found', {
      status: url.pathname === '/' ? 200 : 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP, 'Cache-Control': 'public, max-age=0, must-revalidate' },
    });
  },
};
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const baseEnv: Env = { ASSETS: assets, AGENT_PROVIDER: 'mock', SITE_URL: 'https://liamogrady.dev', __cfLocal: { colo: 'DUB', country: 'IE', city: 'Dublin' } };

function call(path: string, init: RequestInit & { headers?: Record<string, string> } = {}, env: Env = baseEnv) {
  return worker.fetch(new Request(`https://liamogrady.dev${path}`, { ...init, headers: { host: 'liamogrady.dev', ...init.headers } }), env, ctx);
}

const sse = (text: string) =>
  text
    .split('\n\n')
    .filter((f) => f.startsWith('data: '))
    .map((f) => JSON.parse(f.slice(6)) as { type: string; [k: string]: unknown });

describe('GET /', () => {
  it('serves the ANSI CV to curl with the standard headers', async () => {
    const res = await call('/', { headers: { 'user-agent': 'curl/8.9.1', accept: '*/*' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('vary')).toBe('User-Agent, Accept');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('server-timing')).toMatch(/^worker;dur=\d+\.\d, colo;desc="DUB"$/);
    const body = await res.text();
    expect(body).toContain('\x1b[38;5;80m');
    expect(body).toContain('served from DUB in');
  });

  it('drops colour with ?color=0 or ?plain, and answers HEAD without a body', async () => {
    for (const q of ['?color=0', '?plain']) {
      const body = await (await call(`/${q}`, { headers: { 'user-agent': 'curl/8.9.1' } })).text();
      expect(body).not.toContain('\x1b[');
      expect(body).toContain('EXPERIENCE');
    }
    const head = await call('/', { method: 'HEAD', headers: { 'user-agent': 'curl/8.9.1' } });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('passes browsers to the static site and keeps its headers', async () => {
    const res = await call('/', { headers: { 'user-agent': 'Mozilla/5.0', accept: 'text/html,application/xhtml+xml' } });
    expect(await res.text()).toContain('<title>Liam</title>');
    expect(res.headers.get('content-security-policy')).toBe(CSP);
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(res.headers.get('vary')).toBe('User-Agent, Accept');
    expect(res.headers.get('server-timing')).toMatch(/^worker;dur=/);
    const curlAskingForHtml = await call('/', { headers: { 'user-agent': 'curl/8.9.1', accept: 'text/html' } });
    expect(await curlAskingForHtml.text()).toContain('<title>Liam</title>');
  });

  it('rejects other methods with Allow', async () => {
    const res = await call('/', { method: 'POST' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
  });
});

describe('/api', () => {
  it('GET /api/edge reports where the request was served', async () => {
    const res = await call('/api/edge', { headers: { 'cf-ray': '8f1a2b3c4d5e6f70-DUB' } });
    expect(res.headers.get('cache-control')).toBe('private, max-age=0');
    expect(res.headers.get('server-timing')).toContain('colo;desc="DUB"');
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['colo', 'city', 'country', 'httpProtocol', 'tlsVersion', 'rttMs', 'ray', 'time']);
    expect(body).toMatchObject({ colo: 'DUB', city: 'Dublin', country: 'IE', ray: '8f1a2b3c4d5e6f70-DUB' });
  });

  it('uses request.cf when Cloudflare provides it', async () => {
    const req = new Request('https://liamogrady.dev/api/edge');
    Object.defineProperty(req, 'cf', { value: { colo: 'LHR', city: 'London', country: 'GB', httpProtocol: 'HTTP/3', tlsVersion: 'TLSv1.3', clientTcpRtt: 12 } });
    const body = (await (await worker.fetch(req, { ASSETS: assets }, ctx)).json()) as Record<string, unknown>;
    expect(body).toMatchObject({ colo: 'LHR', city: 'London', country: 'GB', httpProtocol: 'HTTP/3', tlsVersion: 'TLSv1.3', rttMs: 12 });
  });

  it('404s unknown API routes and 405s wrong methods', async () => {
    for (const p of ['/api/nope', '/api', '/api/agent/extra']) {
      const res = await call(p);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ ok: false, error: 'not_found' });
    }
    const wrong = await call('/api/agent');
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('allow')).toBe('POST');
    expect((await call('/api/contact', { method: 'PUT' })).headers.get('allow')).toBe('POST');
    expect((await call('/api/edge', { method: 'DELETE' })).headers.get('allow')).toBe('GET, HEAD');
  });

  it('POST /api/agent streams server-sent events', async () => {
    const res = await call('/api/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://liamogrady.dev' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'What certifications does Liam have?' }] }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const events = sse(await res.text());
    expect(events[0]).toMatchObject({ type: 'meta', provider: 'mock', colo: 'DUB', mode: 'chat', fallback: false });
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(events.some((e) => e.type === 'text')).toBe(true);
  });

  it('POST /api/agent validates strictly and rate limits with an SSE error', async () => {
    const bad = await call('/api/agent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: 'hi' }) });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ ok: false, error: 'bad_request' });

    const limited = await call(
      '/api/agent',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) },
      { ...baseEnv, RL_AI: { limit: async () => ({ success: false }) } },
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get('content-type')).toContain('text/event-stream');
    expect(sse(await limited.text())).toEqual([{ type: 'error', code: 'rate_limited', message: expect.any(String) }]);
  });

  it('POST /api/contact falls back to mailto when delivery is not configured', async () => {
    const res = await call('/api/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'hello', name: 'Ada', email: 'ada@example.com', message: 'Hello!' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, error: 'not_configured', mailto: expect.stringMatching(/^mailto:/) });
  });

  it('GET /api/live needs a WebSocket upgrade and a presence binding', async () => {
    expect((await call('/api/live')).status).toBe(426);
    const noBinding = await call('/api/live', { headers: { upgrade: 'websocket' } });
    expect(noBinding.status).toBe(503);
    const foreign = await call('/api/live', { headers: { upgrade: 'websocket', origin: 'https://evil.example' } });
    expect(foreign.status).toBe(403);
  });

  it('GET /api/live hands the socket to the lobby without the visitor IP', async () => {
    let seen: Request | null = null;
    let name = '';
    const PRESENCE = {
      getByName: (n: string) => {
        name = n;
        return { fetch: async (r: Request) => ((seen = r), new Response('upgraded', { status: 200 })) };
      },
    } as unknown as DurableObjectNamespace;
    await call('/api/live', { headers: { upgrade: 'websocket', 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '203.0.113.7' } }, { ...baseEnv, PRESENCE });
    expect(name).toBe('lobby');
    expect(seen!.headers.get('x-presence-country')).toBe('IE');
    expect(seen!.headers.get('cf-connecting-ip')).toBeNull();
    expect(seen!.headers.get('x-forwarded-for')).toBeNull();
    expect(seen!.headers.get('upgrade')).toBe('websocket');
  });
});

describe('/mcp', () => {
  it('redirects browsers to /agents', async () => {
    const res = await call('/mcp', { headers: { accept: 'text/html,application/xhtml+xml' } });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/agents');
  });

  it('serves MCP and rate limits per IP + route', async () => {
    const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } };
    const req = { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'cf-connecting-ip': '198.51.100.4' }, body: JSON.stringify(init) };
    const ok = await call('/mcp', req);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe('*');
    expect(ok.headers.get('cache-control')).toBe('no-store');

    const keys: string[] = [];
    const limited = await call('/mcp', req, { ...baseEnv, RL_MCP: { limit: async ({ key }) => (keys.push(key), { success: false }) } });
    expect(limited.status).toBe(429);
    expect(keys).toEqual(['198.51.100.4:/mcp']);
    expect(await limited.json()).toMatchObject({ jsonrpc: '2.0', error: { code: -32000 } });
  });

  it('405s unsupported methods and 404s sub-paths', async () => {
    const put = await call('/mcp', { method: 'PUT' });
    expect(put.status).toBe(405);
    expect(put.headers.get('allow')).toBe('GET, POST, DELETE, OPTIONS');
    expect((await call('/mcp/anything')).status).toBe(404);
  });
});
