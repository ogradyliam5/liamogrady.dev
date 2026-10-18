#!/usr/bin/env node
/**
 * Smoke test for the MCP endpoint with raw JSON-RPC (no SDK), against a running server:
 *   npm run smoke:mcp                        -> http://127.0.0.1:8787/mcp (wrangler dev)
 *   node scripts/smoke-mcp.mjs <url>          -> any deployment, e.g. https://liamogrady.dev/mcp
 *
 * Exercises both protocol eras the endpoint serves:
 *   2026-07-28  stateless: server/discover -> tools/list -> tools/call(search_profile)
 *               (per-request _meta envelope + MCP-Protocol-Version, Mcp-Method and Mcp-Name headers)
 *   2025-06-18  legacy: initialize -> notifications/initialized -> tools/list -> tools/call(search_profile)
 */
const url = process.argv[2] ?? process.env.MCP_URL ?? 'http://127.0.0.1:8787/mcp';
const EXPECTED_TOOLS = ['get_profile', 'get_experience', 'list_projects', 'get_certifications', 'search_profile', 'assess_role_fit', 'get_contact_options'];
const MODERN = '2026-07-28';
const LEGACY = '2025-06-18';
const META = {
  'io.modelcontextprotocol/protocolVersion': MODERN,
  'io.modelcontextprotocol/clientInfo': { name: 'liamogrady-smoke', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

let failures = 0;
let nextId = 1;

function report(ok, label, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
}

/** Parses a JSON or SSE (event: message / data: ...) response body into the JSON-RPC message. */
function parseBody(contentType, text) {
  if (!text) return null;
  if (contentType.includes('text/event-stream')) {
    const data = text
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .filter(Boolean)
      .pop();
    return data ? JSON.parse(data) : null;
  }
  return JSON.parse(text);
}

async function send(message, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let body = null;
  try {
    body = parseBody(res.headers.get('content-type') ?? '', text);
  } catch {
    body = { unparsed: text.slice(0, 200) };
  }
  return { status: res.status, body };
}

function modern(method, params = {}, name) {
  return send(
    { jsonrpc: '2.0', id: nextId++, method, params: { ...params, _meta: META } },
    { 'MCP-Protocol-Version': MODERN, 'Mcp-Method': method, ...(name ? { 'Mcp-Name': name } : {}) },
  );
}

function legacy(method, params, { notification = false, header = true } = {}) {
  const message = notification ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', id: nextId++, method, params: params ?? {} };
  return send(message, header ? { 'MCP-Protocol-Version': LEGACY } : {});
}

function checkTools(label, r) {
  const names = r.body?.result?.tools?.map((t) => t.name) ?? [];
  const readOnly = (r.body?.result?.tools ?? []).every((t) => t.annotations?.readOnlyHint === true && t.annotations?.openWorldHint === false);
  const ok = r.status === 200 && EXPECTED_TOOLS.every((n) => names.includes(n)) && readOnly;
  report(ok, label, `[${names.join(', ')}]`);
}

function checkSearch(label, r) {
  const hits = r.body?.result?.structuredContent?.hits ?? [];
  const ok = r.status === 200 && !r.body?.result?.isError && hits.length > 0 && hits.every((h) => h.title && h.url && typeof h.score === 'number');
  report(ok, label, ok ? `${hits.length} hits, top: "${hits[0].title}"` : JSON.stringify(r.body).slice(0, 200));
}

async function step(label, fn) {
  try {
    await fn();
  } catch (err) {
    report(false, label, err instanceof Error ? err.message : String(err));
  }
}

console.log(`MCP smoke test against ${url}\n`);

console.log(`-- ${MODERN} (stateless) --`);
await step('server/discover', async () => {
  const r = await modern('server/discover');
  const info = r.body?.result?._meta?.['io.modelcontextprotocol/serverInfo'];
  report(r.status === 200 && r.body?.result?.supportedVersions?.includes(MODERN) && info?.name === 'liamogrady-dev', 'server/discover', info ? `${info.name} ${info.version}` : JSON.stringify(r.body).slice(0, 200));
});
await step('tools/list', async () => checkTools('tools/list', await modern('tools/list')));
await step('tools/call search_profile', async () =>
  checkSearch('tools/call search_profile', await modern('tools/call', { name: 'search_profile', arguments: { query: 'MCP servers', limit: 3 } }, 'search_profile')),
);

console.log(`\n-- ${LEGACY} (legacy initialize handshake) --`);
await step('initialize', async () => {
  const r = await legacy('initialize', { protocolVersion: LEGACY, capabilities: {}, clientInfo: { name: 'liamogrady-smoke', version: '1.0.0' } }, { header: false });
  const info = r.body?.result?.serverInfo;
  report(r.status === 200 && info?.name === 'liamogrady-dev', 'initialize', info ? `${info.name} ${info.version}, protocol ${r.body.result.protocolVersion}` : JSON.stringify(r.body).slice(0, 200));
});
await step('notifications/initialized', async () => {
  const r = await legacy('notifications/initialized', undefined, { notification: true });
  report(r.status === 202 || r.status === 200, 'notifications/initialized', `HTTP ${r.status}`);
});
await step('tools/list', async () => checkTools('tools/list', await legacy('tools/list')));
await step('tools/call search_profile', async () =>
  checkSearch('tools/call search_profile', await legacy('tools/call', { name: 'search_profile', arguments: { query: 'Copilot Studio governance', limit: 3 } })),
);

console.log(`\n${failures ? `${failures} check(s) FAILED` : 'All checks passed'}`);
process.exit(failures ? 1 : 0);
