import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPENAI_MODEL,
  OPENAI_BASE_URL,
  OpenAiResponsesProvider,
  ProviderError,
  isQuotaError,
  reasoningEffort,
  resolveProviders,
  toResponsesInput,
  toResponsesTools,
} from '../../src/worker/agent/providers';
import type { ChatMessage, ToolSpec } from '../../src/worker/agent/types';
import type { Env } from '../../src/worker/env';

type Captured = { url: string; init: RequestInit; body: Record<string, unknown> };

/** A fetch stand-in that records the request and replies with a canned Responses API payload. */
function fakeFetch(reply: unknown, status = 200) {
  const calls: Captured[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {}, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    return new Response(typeof reply === 'string' ? reply : JSON.stringify(reply), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { fetcher, calls };
}

const TOOLS: ToolSpec[] = [
  { name: 'search_profile', description: 'Search the profile', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
];

describe('toResponsesInput', () => {
  it('maps a tool-calling turn to Responses input items', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are Liam’s agent.' },
      { role: 'user', content: 'Has Liam built MCP servers?' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'search_profile', args: { query: 'MCP' } }] },
      { role: 'tool', toolCallId: 'call_1', name: 'search_profile', content: '[{"title":"Vercel MCP server"}]' },
      { role: 'assistant', content: 'Yes.' },
      { role: 'user', content: 'Which one is newest?' },
    ];
    expect(toResponsesInput(messages)).toEqual([
      { role: 'developer', content: 'You are Liam’s agent.' },
      { role: 'user', content: 'Has Liam built MCP servers?' },
      { type: 'function_call', call_id: 'call_1', name: 'search_profile', arguments: '{"query":"MCP"}' },
      { type: 'function_call_output', call_id: 'call_1', output: '[{"title":"Vercel MCP server"}]' },
      { role: 'assistant', content: 'Yes.' },
      { role: 'user', content: 'Which one is newest?' },
    ]);
  });

  it('keeps assistant text that came with tool calls', () => {
    const items = toResponsesInput([{ role: 'assistant', content: 'Checking.', toolCalls: [{ id: 'c', name: 'navigate', args: { section: 'work' } }] }]);
    expect(items).toEqual([
      { role: 'assistant', content: 'Checking.' },
      { type: 'function_call', call_id: 'c', name: 'navigate', arguments: '{"section":"work"}' },
    ]);
  });

  it('flattens tools into the Responses function shape with strict off', () => {
    expect(toResponsesTools(TOOLS)).toEqual([{ type: 'function', name: 'search_profile', description: 'Search the profile', parameters: TOOLS[0]!.parameters, strict: false }]);
  });
});

describe('OpenAiResponsesProvider', () => {
  it('sends a stateless Responses request with tools and no reasoning for chat', async () => {
    const { fetcher, calls } = fakeFetch({
      id: 'resp_1',
      status: 'completed',
      output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_9', name: 'search_profile', arguments: '{"query":"mcp"}', status: 'completed' }],
      usage: { input_tokens: 1200, output_tokens: 18, total_tokens: 1218 },
    });
    const p = new OpenAiResponsesProvider({ apiKey: 'sk-test', model: 'gpt-6-luna', effort: 'none', fetcher });
    const r = await p.chat({ messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'mcp?' }], tools: TOOLS, maxTokens: 700 });

    expect(r).toEqual({ text: '', toolCalls: [{ id: 'call_9', name: 'search_profile', args: { query: 'mcp' } }], usage: { inputTokens: 1200, outputTokens: 18 } });
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.url).toBe('https://api.openai.com/v1/responses');
    expect((c.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(c.body).toMatchObject({
      model: 'gpt-6-luna',
      store: false,
      reasoning: { effort: 'none' },
      max_output_tokens: 700,
      tool_choice: 'auto',
      input: [{ role: 'developer', content: 'sys' }, { role: 'user', content: 'mcp?' }],
    });
    expect(c.body.tools).toEqual(toResponsesTools(TOOLS));
    expect(c.body.text).toBeUndefined();
  });

  it('asks for JSON and leaves room for reasoning on analysis calls', async () => {
    const { fetcher, calls } = fakeFetch({
      output: [
        { type: 'reasoning', id: 'rs_1', summary: [] },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"role":"Lead AI Architect"}', annotations: [] }] },
      ],
      usage: { input_tokens: 3000, output_tokens: 420, output_tokens_details: { reasoning_tokens: 300 } },
    });
    const p = new OpenAiResponsesProvider({ apiKey: 'k', model: 'gpt-6-luna', effort: 'low', baseUrl: 'https://gateway.example/v1/acct/gw/openai/', fetcher });
    const r = await p.chat({ messages: [{ role: 'user', content: 'Return JSON' }], json: true, maxTokens: 2048 });
    expect(r.text).toBe('{"role":"Lead AI Architect"}');
    expect(r.usage).toEqual({ inputTokens: 3000, outputTokens: 420 });
    expect(calls[0]!.url).toBe('https://gateway.example/v1/acct/gw/openai/responses');
    expect(calls[0]!.body).toMatchObject({ reasoning: { effort: 'low' }, max_output_tokens: 2048 + 1024, text: { format: { type: 'json_object' } } });
    expect(calls[0]!.body.tools).toBeUndefined();
  });

  it('treats 429s and insufficient quota as budget errors, and other failures as upstream', async () => {
    const quota = new OpenAiResponsesProvider({ apiKey: 'k', model: 'm', fetcher: fakeFetch({ error: { code: 'insufficient_quota' } }, 429).fetcher });
    const err = await quota.chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).kind).toBe('quota');
    expect(isQuotaError(err)).toBe(true);

    const billing = new OpenAiResponsesProvider({ apiKey: 'k', model: 'm', fetcher: fakeFetch({ error: { type: 'insufficient_quota', message: 'check your plan and billing details' } }, 403).fetcher });
    expect(((await billing.chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 }).catch((e: unknown) => e)) as ProviderError).kind).toBe('quota');

    const bad = new OpenAiResponsesProvider({ apiKey: 'k', model: 'm', fetcher: fakeFetch({ error: { message: 'Invalid API key' } }, 401).fetcher });
    const e2 = (await bad.chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 }).catch((e: unknown) => e)) as ProviderError;
    expect(e2.kind).toBe('upstream');
    expect(e2.status).toBe(401);
  });

  it('reports a network failure as upstream', async () => {
    const p = new OpenAiResponsesProvider({ apiKey: 'k', model: 'm', fetcher: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch });
    const e = (await p.chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 }).catch((x: unknown) => x)) as ProviderError;
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.kind).toBe('upstream');
  });
});

describe('resolveProviders (openai)', () => {
  it('uses GPT-6 Luna with no reasoning for chat and low reasoning for analysis by default', () => {
    const r = resolveProviders({ AGENT_PROVIDER: 'openai', OPENAI_API_KEY: ' sk-x ' } as Env);
    expect(r.kind).toBe('openai');
    expect(r.chat).toBeInstanceOf(OpenAiResponsesProvider);
    expect(r.chat).toMatchObject({ name: 'openai', model: DEFAULT_OPENAI_MODEL, effort: 'none' });
    expect(r.reason).toMatchObject({ name: 'openai', model: DEFAULT_OPENAI_MODEL, effort: 'low' });
    expect(OPENAI_BASE_URL).toBe('https://api.openai.com/v1');
  });

  it('honours model and effort overrides', () => {
    const r = resolveProviders({ AGENT_PROVIDER: 'OpenAI', OPENAI_API_KEY: 'k', OPENAI_MODEL: 'gpt-6.1-sol', OPENAI_MODEL_REASON: 'gpt-6-astra', OPENAI_REASONING_CHAT: 'low', OPENAI_REASONING_ANALYSIS: 'bogus' } as Env);
    expect(r.chat).toMatchObject({ model: 'gpt-6.1-sol', effort: 'low' });
    expect(r.reason).toMatchObject({ model: 'gpt-6-astra', effort: 'low' });
  });

  it('falls back to the deterministic agent until the key is set', () => {
    expect(resolveProviders({ AGENT_PROVIDER: 'openai' } as Env)).toEqual({ kind: 'none', chat: null, reason: null });
    expect(resolveProviders({ AGENT_PROVIDER: 'openai', OPENAI_API_KEY: '   ' } as Env).kind).toBe('none');
  });

  it('validates reasoning effort values', () => {
    expect(reasoningEffort('HIGH', 'none')).toBe('high');
    expect(reasoningEffort('minimal', 'none')).toBe('none');
    expect(reasoningEffort(undefined, 'low')).toBe('low');
  });
});
