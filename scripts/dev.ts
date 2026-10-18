/**
 * Local dev server (Bun): serves dist/ like Workers Static Assets would, and sends
 * worker-first routes (/, /api/*, /mcp) through the real Worker code with local
 * stand-ins for the Cloudflare bindings. `bun scripts/dev.ts [--port 8787] [--no-build]`
 */
import { join, extname } from 'node:path';
import { stat } from 'node:fs/promises';
import { build } from './build';
import { localEnv } from './local-env';

const root = join(import.meta.dir, '..');
const dist = join(root, 'dist');
const portArg = process.argv.indexOf('--port');
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : 8787;

if (!process.argv.includes('--no-build')) await build();

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
};

async function fileResponse(pathname: string): Promise<Response | null> {
  let p = decodeURIComponent(pathname);
  if (p.endsWith('/')) p += 'index.html';
  const candidates = [p, p + '.html', p + '/index.html'];
  for (const c of candidates) {
    const full = join(dist, c);
    if (!full.startsWith(dist)) return null;
    try {
      const s = await stat(full);
      if (s.isFile()) {
        return new Response(Bun.file(full), {
          headers: { 'content-type': TYPES[extname(full)] ?? 'application/octet-stream', 'cache-control': 'no-store' },
        });
      }
    } catch {
      /* next */
    }
  }
  return null;
}

const ASSETS = {
  async fetch(input: Request | string): Promise<Response> {
    const url = new URL(typeof input === 'string' ? input : input.url);
    return (await fileResponse(url.pathname)) ?? (await fileResponse('/404.html')) ?? new Response('Not found', { status: 404 });
  },
};

let worker: { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> } | null = null;
try {
  worker = (await import('../src/worker/index')).default;
} catch (e) {
  console.warn('worker not loaded:', (e as Error).message);
}

const env = await localEnv(ASSETS);
const ctx = { waitUntil: (_p: Promise<unknown>) => {}, passThroughOnException: () => {} };

Bun.serve({
  port,
  idleTimeout: 120,
  async fetch(req, server) {
    const url = new URL(req.url);
    const workerFirst = url.pathname === '/' || url.pathname.startsWith('/api/') || url.pathname === '/mcp' || url.pathname.startsWith('/mcp/');
    if (workerFirst && worker) {
      if (req.headers.get('upgrade') === 'websocket') {
        // Presence in local dev: echo-only socket so the client code path runs.
        if (server.upgrade(req)) return undefined as unknown as Response;
      }
      return worker.fetch(req, { ...env, __cfLocal: { colo: 'LOCAL', country: 'GB', city: 'London' } }, ctx);
    }
    return ASSETS.fetch(req);
  },
  websocket: {
    open(ws) {
      ws.send(JSON.stringify({ t: 'welcome', id: 'local', here: 1, peers: [] }));
    },
    message() {},
  },
});
console.log(`dev server on http://localhost:${port}`);
