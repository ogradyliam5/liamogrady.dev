import { describe, expect, it } from 'vitest';
import { MCP_TOOLS_SUMMARY } from '../../src/shared/mcp-summary';
import type { Env } from '../../src/worker/env';
import { mcpHandlerFor } from '../../src/worker/mcp/handler';
import { SERVER_NAME, SERVER_VERSION } from '../../src/worker/mcp/server';

const TOOLS = ['get_profile', 'get_experience', 'list_projects', 'get_certifications', 'search_profile', 'assess_role_fit', 'get_contact_options'];
const META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'vitest', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

type Rpc = { status: number; body: { result?: Record<string, any>; error?: { code: number; message: string } } };

async function post(payload: unknown, headers: Record<string, string> = {}, host = 'liamogrady.dev'): Promise<Rpc> {
  const req = new Request(`https://${host}/mcp`, {
    method: 'POST',
    headers: { host, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: JSON.stringify(payload),
  });
  const res = await mcpHandlerFor({} as Env, host).fetch(req);
  const text = await res.text();
  const data = (res.headers.get('content-type') ?? '').includes('text/event-stream')
    ? text
        .split('\n')
        .find((l) => l.startsWith('data: '))
        ?.slice(6)
    : text;
  return { status: res.status, body: data ? JSON.parse(data) : {} };
}

/** 2025-era client: no envelope, protocol version in the initialize handshake. */
const legacy = (method: string, params: Record<string, unknown> = {}, id = 1) =>
  post({ jsonrpc: '2.0', id, method, params }, method === 'initialize' ? {} : { 'mcp-protocol-version': '2025-06-18' });

/** 2026-07-28 client: per-request _meta envelope plus Mcp-Method / Mcp-Name headers, no handshake. */
const modern = (method: string, params: Record<string, unknown> = {}, name?: string) =>
  post(
    { jsonrpc: '2.0', id: 7, method, params: { ...params, _meta: META } },
    { 'mcp-protocol-version': '2026-07-28', 'mcp-method': method, ...(name ? { 'mcp-name': name } : {}) },
  );

describe('MCP server (2025-era clients through the stateless legacy lane)', () => {
  it('initialises, lists the seven read-only tools and calls search_profile', async () => {
    const init = await legacy('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'vitest', version: '1' } });
    expect(init.status).toBe(200);
    expect(init.body.result!.serverInfo).toMatchObject({ name: SERVER_NAME, title: "Liam O'Grady — public profile", version: SERVER_VERSION });
    expect(init.body.result!.instructions).toContain('deliberately excluded');

    const list = await legacy('tools/list');
    const tools = list.body.result!.tools as { name: string; annotations: Record<string, boolean> }[];
    expect(tools.map((t) => t.name)).toEqual(TOOLS);
    for (const t of tools) expect(t.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    for (const name of TOOLS) expect(MCP_TOOLS_SUMMARY).toContain(name);

    const call = await legacy('tools/call', { name: 'search_profile', arguments: { query: 'MCP servers', limit: 3 } });
    const result = call.body.result!;
    expect(result.isError).toBeFalsy();
    expect(result.content[0].type).toBe('text');
    expect(result.structuredContent.hits.length).toBeGreaterThan(0);
    expect(result.structuredContent.hits.length).toBeLessThanOrEqual(3);
    expect(result.structuredContent.hits[0]).toEqual(expect.objectContaining({ title: expect.any(String), text: expect.any(String), url: expect.any(String), score: expect.any(Number) }));
  });

  it('caps inputs', async () => {
    const tooMany = await legacy('tools/call', { name: 'search_profile', arguments: { query: 'agents', limit: 50 } });
    expect(tooMany.body.result!.isError).toBe(true);
    const longJd = await legacy('tools/call', { name: 'assess_role_fit', arguments: { job_description: 'x'.repeat(8001) } });
    expect(longJd.body.result!.isError).toBe(true);
  });
});

describe('MCP server (2026-07-28 stateless clients)', () => {
  it('answers server/discover with the instructions and server info', async () => {
    const r = await modern('server/discover');
    expect(r.status).toBe(200);
    expect(r.body.result!.supportedVersions).toContain('2026-07-28');
    expect(r.body.result!._meta['io.modelcontextprotocol/serverInfo'].name).toBe(SERVER_NAME);
    expect(Object.keys(r.body.result!.capabilities)).toEqual(expect.arrayContaining(['tools', 'resources', 'prompts']));
  });

  it('runs every tool', async () => {
    const profile = await modern('tools/call', { name: 'get_profile', arguments: { section: 'certifications' } }, 'get_profile');
    expect(profile.body.result!.content[0].text).toContain('learn.microsoft.com');
    expect(profile.body.result!.structuredContent.section).toBe('certifications');

    const whole = await modern('tools/call', { name: 'get_profile', arguments: {} }, 'get_profile');
    expect(whole.body.result!.content[0].text).toContain("# Liam O'Grady");

    const experience = await modern('tools/call', { name: 'get_experience', arguments: {} }, 'get_experience');
    expect(experience.body.result!.structuredContent.roles.map((r: { id: string }) => r.id)).toContain('air-partner');

    const projects = await modern('tools/call', { name: 'list_projects', arguments: {} }, 'list_projects');
    const ids = projects.body.result!.structuredContent.projects.map((p: { id: string }) => p.id);
    expect(ids).toContain('claw-pc');
    expect(ids).not.toContain('drift-review'); // unpublished

    const certs = await modern('tools/call', { name: 'get_certifications', arguments: {} }, 'get_certifications');
    expect(certs.body.result!.structuredContent.certifications.every((c: { verifyUrl: string }) => c.verifyUrl.startsWith('https://learn.microsoft.com/'))).toBe(true);

    const fit = await modern(
      'tools/call',
      { name: 'assess_role_fit', arguments: { job_description: '- Design Copilot Studio agents\n- Experience with SAP S/4HANA finance modules' } },
      'assess_role_fit',
    );
    const a = fit.body.result!.structuredContent;
    expect(a.requirements.map((r: { coverage: string }) => r.coverage)).toEqual(['strong', 'none']);
    expect(a.overall).toBe(50);
    expect(a.note).toContain('Reason over the evidence');

    const contact = await modern('tools/call', { name: 'get_contact_options', arguments: {} }, 'get_contact_options');
    expect(contact.body.result!.structuredContent).toMatchObject({ email: 'ogradyliam5@gmail.com', cvRequest: 'https://liamogrady.dev/#contact' });
  });

  it('serves the profile resources and prompts', async () => {
    const list = await modern('resources/list');
    expect(list.body.result!.resources.map((r: { uri: string }) => r.uri)).toEqual(['liam://profile.md', 'liam://profile.json']);
    const md = await modern('resources/read', { uri: 'liam://profile.md' }, 'liam://profile.md');
    expect(md.body.result!.contents[0]).toMatchObject({ uri: 'liam://profile.md', mimeType: 'text/markdown' });
    const json = await modern('resources/read', { uri: 'liam://profile.json' }, 'liam://profile.json');
    expect(JSON.parse(json.body.result!.contents[0].text).experience.roles.length).toBeGreaterThan(0);

    const prompts = await modern('prompts/list');
    expect(prompts.body.result!.prompts.map((p: { name: string }) => p.name)).toEqual(['introduce_liam', 'assess_fit']);
    const p = await modern('prompts/get', { name: 'assess_fit', arguments: { job_description: 'Lead architect for Copilot Studio' } }, 'assess_fit');
    expect(p.body.result!.messages[0].content.text).toContain('assess_role_fit');
  });

  it('rejects unknown Host headers (DNS rebinding protection)', async () => {
    const r = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, {}, 'evil.example');
    expect(r.status).toBe(403);
  });

  it('accepts this Worker’s own workers.dev host', async () => {
    const r = await post(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'v', version: '1' } } },
      {},
      'liamogrady-dev.liam.workers.dev',
    );
    expect(r.status).toBe(200);
  });
});
