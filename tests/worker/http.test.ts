import { describe, expect, it } from 'vitest';
import { allowedHostnames, clientIp, finalize, isOwnWorkersDev, json, originAllowed, rateLimited, readJson } from '../../src/worker/http';

describe('finalize', () => {
  it('stamps the standard headers on Worker responses', () => {
    const res = finalize(json({ ok: true }, { status: 201 }), performance.now(), { colo: 'LHR' });
    expect(res.status).toBe(201);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('server-timing')).toMatch(/^worker;dur=\d+\.\d, colo;desc="LHR"$/);
  });

  it('keeps static asset headers in passthrough mode', () => {
    const asset = new Response('<html>', { headers: { 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Security-Policy': "default-src 'self'" } });
    const res = finalize(asset, performance.now(), { passthrough: true, vary: 'User-Agent, Accept' });
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'self'");
    expect(res.headers.get('x-content-type-options')).toBeNull();
    expect(res.headers.get('vary')).toBe('User-Agent, Accept');
  });

  it('allows a custom Cache-Control', () => {
    expect(finalize(json({}), 0, { cache: 'private, max-age=0' }).headers.get('cache-control')).toBe('private, max-age=0');
  });
});

describe('hosts and origins', () => {
  it('recognises this Worker’s workers.dev hosts and preview URLs only', () => {
    expect(isOwnWorkersDev('liamogrady-dev.liam.workers.dev')).toBe(true);
    expect(isOwnWorkersDev('abc12345-liamogrady-dev.liam.workers.dev')).toBe(true);
    expect(isOwnWorkersDev('liamogrady-dev-dev.liam.workers.dev')).toBe(true);
    expect(isOwnWorkersDev('abc12345-liamogrady-dev-dev.liam.workers.dev')).toBe(true);
    expect(isOwnWorkersDev('liamogrady-dev-staging.liam.workers.dev')).toBe(false);
    expect(isOwnWorkersDev('other-worker.liam.workers.dev')).toBe(false);
    expect(isOwnWorkersDev('liamogrady-dev.liam.workers.dev.evil.com')).toBe(false);
  });

  it('builds the allow-list from the site, localhost, ALLOWED_HOSTS and the request host', () => {
    expect(allowedHostnames({})).toEqual(['liamogrady.dev', 'www.liamogrady.dev', 'dev.liamogrady.dev', 'localhost', '127.0.0.1', '[::1]']);
    expect(allowedHostnames({ ALLOWED_HOSTS: ' Staging.liamogrady.dev , ' }, 'liamogrady-dev.liam.workers.dev')).toEqual([
      'liamogrady.dev',
      'www.liamogrady.dev',
      'dev.liamogrady.dev',
      'localhost',
      '127.0.0.1',
      '[::1]',
      'staging.liamogrady.dev',
      'liamogrady-dev.liam.workers.dev',
    ]);
  });

  it('checks browser Origins', () => {
    const req = (origin?: string) => new Request('https://liamogrady.dev/api/agent', { method: 'POST', headers: origin ? { origin } : {} });
    expect(originAllowed(req(), {})).toBe(true);
    expect(originAllowed(req('https://liamogrady.dev'), {})).toBe(true);
    expect(originAllowed(req('https://www.liamogrady.dev'), {})).toBe(true);
    expect(originAllowed(req('http://localhost:5173'), {})).toBe(true);
    expect(originAllowed(req('https://evil.example'), {})).toBe(false);
    expect(originAllowed(req('null'), {})).toBe(false);
  });

  it('reads the client IP from Cloudflare first', () => {
    expect(clientIp(new Request('https://x', { headers: { 'cf-connecting-ip': '203.0.113.1', 'x-forwarded-for': '10.0.0.1' } }))).toBe('203.0.113.1');
    expect(clientIp(new Request('https://x', { headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' } }))).toBe('10.0.0.1');
    expect(clientIp(new Request('https://x'))).toBe('local');
  });
});

describe('readJson and rate limits', () => {
  const post = (body: string, headers: Record<string, string> = { 'content-type': 'application/json' }) => new Request('https://x', { method: 'POST', headers, body });

  it('parses JSON within the size cap', async () => {
    expect(await readJson(post('{"a":1}'), 100)).toEqual({ ok: true, value: { a: 1 } });
    expect(await readJson(post('{"a":"' + 'x'.repeat(200) + '"}'), 100)).toMatchObject({ ok: false, status: 413 });
    expect(await readJson(post('{"a":', { 'content-type': 'application/json; charset=utf-8' }), 100)).toMatchObject({ ok: false, status: 400 });
    expect(await readJson(post('a=1', { 'content-type': 'application/x-www-form-urlencoded' }), 100)).toMatchObject({ ok: false, status: 415 });
  });

  it('fails open without a binding or when the limiter errors', async () => {
    expect(await rateLimited(undefined, 'k')).toBe(false);
    expect(await rateLimited({ limit: async () => Promise.reject(new Error('down')) }, 'k')).toBe(false);
    expect(await rateLimited({ limit: async () => ({ success: true }) }, 'k')).toBe(false);
    expect(await rateLimited({ limit: async () => ({ success: false }) }, 'k')).toBe(true);
  });
});
