import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../scripts/wrangler-safe.mjs', import.meta.url).href);
const DUMMY_TOKEN = 'lod-dev-dummy-token';
const DUMMY_ACCOUNT = '00000000000000000000000000000000';

/** Runs the wrapper in dry-run mode: it decides and prints, but never starts wrangler. */
function safe(args: string[], env: Record<string, string | undefined> = {}) {
  const childEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, WRANGLER_SAFE_DRY_RUN: '1', ...env })) {
    if (v !== undefined && !/^CLOUDFLARE_|^LOD_DEPLOY$/.test(k)) childEnv[k] = v;
  }
  for (const [k, v] of Object.entries(env)) if (v !== undefined && /^CLOUDFLARE_|^LOD_DEPLOY$/.test(k)) childEnv[k] = v;
  const r = spawnSync(process.execPath, [script, ...args], { env: childEnv, encoding: 'utf8', timeout: 15_000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe('scripts/wrangler-safe.mjs', () => {
  it('runs dev in local mode with the dummy credentials, whatever the caller has set', () => {
    const r = safe(['dev', '--port', '8787'], { CLOUDFLARE_API_TOKEN: 'real-looking-token', CLOUDFLARE_ACCOUNT_ID: 'abcdef0123456789abcdef0123456789' });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual({ args: ['dev', '--port', '8787', '--local'], CLOUDFLARE_API_TOKEN: DUMMY_TOKEN, CLOUDFLARE_ACCOUNT_ID: DUMMY_ACCOUNT });
  });

  it('runs types with the dummy credentials', () => {
    const r = safe(['types']);
    expect(JSON.parse(r.out)).toMatchObject({ args: ['types'], CLOUDFLARE_API_TOKEN: DUMMY_TOKEN });
  });

  it.each([['login'], ['logout'], ['whoami'], ['versions', 'upload'], ['tail'], ['kv', 'namespace', 'list'], ['d1', 'list']])('refuses wrangler %s', (...args) => {
    const r = safe(args);
    expect(r.code).toBe(1);
    expect(r.err).toContain('Refusing');
  });

  it.each([['dev', '--remote'], ['dev', '-r'], ['dev', '--tunnel'], ['dev', '--profile=band'], ['types', '--profile', 'x']])('refuses %s %s', (...args) => {
    const r = safe(args);
    expect(r.code).toBe(1);
    expect(r.err).toContain('Refusing');
  });

  it('refuses to deploy without explicit credentials and LOD_DEPLOY=1', () => {
    for (const env of [
      {},
      { LOD_DEPLOY: '1' },
      { LOD_DEPLOY: '1', CLOUDFLARE_API_TOKEN: DUMMY_TOKEN, CLOUDFLARE_ACCOUNT_ID: 'abcdef0123456789abcdef0123456789' },
      { LOD_DEPLOY: '1', CLOUDFLARE_API_TOKEN: 'real-looking-token', CLOUDFLARE_ACCOUNT_ID: DUMMY_ACCOUNT },
      { CLOUDFLARE_API_TOKEN: 'real-looking-token', CLOUDFLARE_ACCOUNT_ID: 'abcdef0123456789abcdef0123456789' },
    ]) {
      const r = safe(['deploy'], env);
      expect(r.code, JSON.stringify(env)).toBe(1);
      expect(r.err).toContain('The Kings of Connaught');
    }
    expect(safe(['secret', 'put', 'TURNSTILE_SECRET']).code).toBe(1);
  });

  it('allows deploy only with both explicit values and LOD_DEPLOY=1 (credentials redacted)', () => {
    const r = safe(['deploy'], { LOD_DEPLOY: '1', CLOUDFLARE_API_TOKEN: 'real-looking-token', CLOUDFLARE_ACCOUNT_ID: 'abcdef0123456789abcdef0123456789' });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual({ args: ['deploy'], CLOUDFLARE_API_TOKEN: '<explicit>', CLOUDFLARE_ACCOUNT_ID: '<explicit>' });
    expect(r.out).not.toContain('real-looking-token');
  });
});
