/**
 * liamogrady.dev Worker. Only the paths in wrangler.jsonc `run_worker_first` reach this code;
 * everything else is served straight from the static assets in ./dist.
 *
 *   GET  /             terminal CV for curl, wget, HTTPie, xh and PowerShell; the static site otherwise
 *   POST /mcp          public, read-only MCP server (GET from a browser redirects to /agents)
 *   POST /api/agent    on-site agent (server-sent events)
 *   GET  /api/live     presence WebSocket, handed to the "lobby" Durable Object
 *   POST /api/contact  contact / CV request
 *   GET  /api/edge     where and how this request was served
 */
import { handleAgent } from './agent';
import { handleContact } from './contact';
import type { Env } from './env';
import { clientIp, edgeInfo, finalize, json, now, originAllowed, rateLimited } from './http';
import { mcpHandlerFor } from './mcp/handler';
import { isTerminalClient, terminalResponse, wantsColor } from './terminal';

export { Presence } from './presence';
export { Budget } from './budget';

const MCP_METHODS = ['GET', 'POST', 'DELETE', 'OPTIONS'];
const PRIVATE_HEADERS = ['CF-Connecting-IP', 'CF-Connecting-IPv6', 'True-Client-IP', 'X-Forwarded-For', 'X-Real-IP', 'Cookie'];

function methodNotAllowed(allow: string[]): Response {
  return json({ ok: false, error: 'method_not_allowed', allow }, { status: 405, headers: { Allow: allow.join(', ') } });
}

function notFound(): Response {
  return json({ ok: false, error: 'not_found' }, { status: 404 });
}

async function home(request: Request, env: Env, started: number, colo: string): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return finalize(methodNotAllowed(['GET', 'HEAD']), started, { colo });
  if (isTerminalClient(request.headers.get('User-Agent'), request.headers.get('Accept'))) {
    const res = terminalResponse(request, { siteUrl: env.SITE_URL, colo, elapsedMs: now() - started, color: wantsColor(new URL(request.url)) });
    return finalize(res, started, { colo });
  }
  if (!env.ASSETS) return finalize(json({ ok: false, error: 'assets_unavailable' }, { status: 503 }), started, { colo });
  // The asset response keeps its own headers (dist/_headers: CSP and friends); "/" varies by client.
  return finalize(await env.ASSETS.fetch(request), started, { passthrough: true, vary: 'User-Agent, Accept' });
}

async function mcp(request: Request, env: Env, started: number, colo: string, url: URL): Promise<Response> {
  if (url.pathname !== '/mcp') return finalize(notFound(), started, { colo });
  if (!MCP_METHODS.includes(request.method)) return finalize(methodNotAllowed(MCP_METHODS), started, { colo });
  if (request.method === 'GET' && (request.headers.get('Accept') ?? '').includes('text/html')) {
    return finalize(new Response(null, { status: 302, headers: { Location: '/agents' } }), started, { colo });
  }
  if (request.method === 'POST' && (await rateLimited(env.RL_MCP, `${clientIp(request)}:/mcp`))) {
    const body = { jsonrpc: '2.0', error: { code: -32000, message: 'Rate limit exceeded (60 requests a minute). Try again shortly.' }, id: null };
    return finalize(json(body, { status: 429, headers: { 'Retry-After': '60', 'Access-Control-Allow-Origin': '*' } }), started, { colo });
  }
  return finalize(await mcpHandlerFor(env, url.hostname).fetch(request), started, { colo });
}

function edge(request: Request, env: Env): Response {
  const body = { ...edgeInfo(request, env), ray: request.headers.get('CF-Ray'), time: new Date().toISOString() };
  return request.method === 'HEAD' ? new Response(null, { headers: { 'Content-Type': 'application/json; charset=utf-8' } }) : json(body);
}

async function live(request: Request, env: Env, started: number, colo: string): Promise<Response> {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return finalize(json({ ok: false, error: 'expected_websocket' }, { status: 426, headers: { Upgrade: 'websocket' } }), started, { colo });
  }
  if (!originAllowed(request, env)) return finalize(json({ ok: false, error: 'forbidden_origin' }, { status: 403 }), started, { colo });
  if (!env.PRESENCE) return finalize(json({ ok: false, error: 'presence_unavailable' }, { status: 503 }), started, { colo });
  // The Durable Object only ever learns the visitor's country, never their IP.
  const headers = new Headers(request.headers);
  for (const h of PRIVATE_HEADERS) headers.delete(h);
  headers.set('X-Presence-Country', edgeInfo(request, env).country ?? 'XX');
  const stub = env.PRESENCE.getByName('lobby');
  return stub.fetch(new Request(request.url, { method: 'GET', headers }));
}

async function api(request: Request, env: Env, ctx: ExecutionContext, started: number, colo: string, url: URL): Promise<Response> {
  const m = request.method;
  switch (url.pathname) {
    case '/api/agent':
      if (m !== 'POST') return finalize(methodNotAllowed(['POST']), started, { colo });
      return finalize(await handleAgent(request, env, ctx), started, { colo });
    case '/api/contact':
      if (m !== 'POST') return finalize(methodNotAllowed(['POST']), started, { colo });
      return finalize(await handleContact(request, env), started, { colo });
    case '/api/edge':
      if (m !== 'GET' && m !== 'HEAD') return finalize(methodNotAllowed(['GET', 'HEAD']), started, { colo });
      return finalize(edge(request, env), started, { colo, cache: 'private, max-age=0' });
    case '/api/live':
      if (m !== 'GET') return finalize(methodNotAllowed(['GET']), started, { colo });
      return finalize(await live(request, env, started, colo), started, { colo });
    default:
      return finalize(notFound(), started, { colo });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const started = now();
    const url = new URL(request.url);
    const colo = edgeInfo(request, env).colo;
    try {
      if (url.pathname === '/') return await home(request, env, started, colo);
      if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) return await mcp(request, env, started, colo, url);
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return await api(request, env, ctx, started, colo, url);
      // Anything else that reaches the Worker belongs to the static site (404 page included).
      if (env.ASSETS) return finalize(await env.ASSETS.fetch(request), started, { passthrough: true });
      return finalize(notFound(), started, { colo });
    } catch (err) {
      console.error(`unhandled ${request.method} ${url.pathname}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      return finalize(json({ ok: false, error: 'internal_error' }, { status: 500 }), started, { colo });
    }
  },
} satisfies ExportedHandler<Env>;
