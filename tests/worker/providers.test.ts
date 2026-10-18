import { describe, expect, it } from 'vitest';
import {
  OpenAiCompatibleProvider,
  ProviderError,
  WorkersAiProvider,
  isQuotaError,
  normalizeAiResponse,
  resolveProviders,
  stripReasoning,
  toWireMessages,
} from '../../src/worker/agent/providers';
import type { ChatMessage } from '../../src/worker/agent/types';
import type { Env } from '../../src/worker/env';

describe('normalizeAiResponse', () => {
  it('handles the OpenAI-style shape newer Workers AI models return', () => {
    const r = normalizeAiResponse({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: 'call_a', type: 'function', function: { name: 'search_profile', arguments: '{"query":"mcp"}' } },
              { id: 'call_b', type: 'function', function: { name: 'navigate', arguments: { section: 'work' } } },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
    });
    expect(r).toEqual({
      text: '',
      toolCalls: [
        { id: 'call_a', name: 'search_profile', args: { query: 'mcp' } },
        { id: 'call_b', name: 'navigate', args: { section: 'work' } },
      ],
      usage: { inputTokens: 120, outputTokens: 30 },
    });
  });

  it('handles the classic Workers AI shape', () => {
    const r = normalizeAiResponse({ response: 'Hello', tool_calls: [{ name: 'scene', arguments: { name: 'swarm' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } });
    expect(r).toEqual({ text: 'Hello', toolCalls: [{ id: 'call_0', name: 'scene', args: { name: 'swarm' } }], usage: { inputTokens: 5, outputTokens: 2 } });
  });

  it('stringifies JSON-mode objects and strips inline reasoning', () => {
    expect(normalizeAiResponse({ response: { a: 1 } }).text).toBe('{"a":1}');
    expect(normalizeAiResponse({ choices: [{ message: { content: '<think>secret plan</think>Answer.' } }] }).text).toBe('Answer.');
    expect(stripReasoning('reasoning without opener</think> Final')).toBe('Final');
  });

  it('handles Responses-API output and content parts', () => {
    const r = normalizeAiResponse({
      output: [
        { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'hidden' }] },
        { type: 'message', content: [{ type: 'output_text', text: 'Hi ' }, { type: 'output_text', text: 'there' }] },
        { type: 'function_call', call_id: 'fc_1', name: 'open_xray', arguments: '{}' },
      ],
      usage: { input_tokens: 9, output_tokens: 4 },
    });
    expect(r).toEqual({ text: 'Hi there', toolCalls: [{ id: 'fc_1', name: 'open_xray', args: {} }], usage: { inputTokens: 9, outputTokens: 4 } });
  });

  it('tolerates bad tool arguments and rejects unknown shapes', () => {
    const r = normalizeAiResponse({ response: '', tool_calls: [{ name: 'search_profile', arguments: '{not json' }, { arguments: '{}' }] });
    expect(r.toolCalls).toEqual([{ id: 'call_0', name: 'search_profile', args: {} }]);
    expect(normalizeAiResponse('plain').text).toBe('plain');
    expect(() => normalizeAiResponse({ weird: true })).toThrow(ProviderError);
    expect(() => normalizeAiResponse(null)).toThrow(ProviderError);
  });
});

describe('quota detection', () => {
  it.each(['AiError: 3036: Account limit of 10000 daily neurons exceeded', '4006: you have used up your daily free allocation', 'HTTP 429 Too Many Requests'])('%s', (m) => {
    expect(isQuotaError(new Error(m))).toBe(true);
  });
  it('does not flag ordinary failures', () => {
    expect(isQuotaError(new Error('5007: No such model'))).toBe(false);
  });
});

const conversation: ChatMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'hi' },
  { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'search_profile', args: { query: 'x' } }] },
  { role: 'tool', toolCallId: 'c1', name: 'search_profile', content: '[]' },
];

describe('providers', () => {
  it('Workers AI: sends OpenAI-style tools, uses the gateway and normalises both shapes', async () => {
    const calls: { model: string; input: Record<string, unknown>; options?: Record<string, unknown> }[] = [];
    const shapes: unknown[] = [{ response: 'old shape' }, { choices: [{ message: { content: 'new shape' } }] }];
    const ai = {
      run: async (model: string, input: Record<string, unknown>, options?: Record<string, unknown>) => {
        calls.push({ model, input, options });
        return shapes.shift();
      },
    };
    const p = new WorkersAiProvider(ai, '@cf/zai-org/glm-4.7-flash', 'gw-1');
    expect((await p.chat({ messages: conversation, tools: [{ name: 't', description: 'd', parameters: { type: 'object' } }], maxTokens: 50 })).text).toBe('old shape');
    expect((await p.chat({ messages: conversation, maxTokens: 50 })).text).toBe('new shape');
    expect(calls[0]!.model).toBe('@cf/zai-org/glm-4.7-flash');
    expect(calls[0]!.options).toEqual({ gateway: { id: 'gw-1' } });
    expect(calls[0]!.input.max_tokens).toBe(50);
    expect(calls[0]!.input.tools).toEqual([{ type: 'function', function: { name: 't', description: 'd', parameters: { type: 'object' } } }]);
    expect(calls[1]!.input.tools).toBeUndefined();
    const wire = calls[0]!.input.messages as Record<string, unknown>[];
    expect(wire[2]).toEqual({ role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search_profile', arguments: '{"query":"x"}' } }] });
    expect(wire[3]).toEqual({ role: 'tool', tool_call_id: 'c1', name: 'search_profile', content: '[]' });
  });

  it('Workers AI: classifies quota errors', async () => {
    const p = new WorkersAiProvider({ run: async () => Promise.reject(new Error('3036: daily neurons exceeded')) }, 'm');
    await expect(p.chat({ messages: conversation, maxTokens: 10 })).rejects.toMatchObject({ kind: 'quota' });
  });

  it('openai-compatible: Azure api-key header + api-version, or Bearer for OpenAI', async () => {
    const seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
      return Response.json({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    }) as unknown as typeof fetch;
    const azure = new OpenAiCompatibleProvider({ baseUrl: 'https://res.openai.azure.com/openai/deployments/gpt/', apiKey: 'k1', model: 'gpt', authHeader: 'api-key', apiVersion: '2024-10-21', fetcher });
    await azure.chat({ messages: conversation, json: true, maxTokens: 99 });
    expect(seen[0]!.url).toBe('https://res.openai.azure.com/openai/deployments/gpt/chat/completions?api-version=2024-10-21');
    expect(seen[0]!.headers['api-key']).toBe('k1');
    expect(seen[0]!.headers.Authorization).toBeUndefined();
    expect(seen[0]!.body).toMatchObject({ model: 'gpt', max_completion_tokens: 99, response_format: { type: 'json_object' } });
    expect((seen[0]!.body.messages as Record<string, unknown>[])[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '[]' });

    const openai = new OpenAiCompatibleProvider({ baseUrl: 'https://api.openai.com/v1', apiKey: 'k2', model: 'gpt-5-mini', tokenParam: 'max_tokens', fetcher });
    await openai.chat({ messages: conversation, tools: [{ name: 't', description: 'd', parameters: {} }], maxTokens: 10 });
    expect(seen[1]!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(seen[1]!.headers.Authorization).toBe('Bearer k2');
    expect(seen[1]!.body).toMatchObject({ max_tokens: 10, tool_choice: 'auto' });
  });

  it('openai-compatible: maps HTTP errors', async () => {
    const fetcher = (async () => new Response('slow down', { status: 429 })) as unknown as typeof fetch;
    const p = new OpenAiCompatibleProvider({ baseUrl: 'https://x', apiKey: 'k', model: 'm', fetcher });
    await expect(p.chat({ messages: conversation, maxTokens: 5 })).rejects.toMatchObject({ kind: 'quota', status: 429 });
  });

  it('resolves providers from configuration', () => {
    const ai = { run: async () => ({ response: '' }) };
    expect(resolveProviders({ AI: ai } as Env)).toMatchObject({ kind: 'workers-ai', chat: { model: '@cf/zai-org/glm-4.7-flash' }, reason: { model: '@cf/openai/gpt-oss-120b' } });
    expect(resolveProviders({ AGENT_PROVIDER: 'workers-ai' } as Env)).toEqual({ kind: 'none', chat: null, reason: null });
    expect(resolveProviders({ AGENT_PROVIDER: 'mock' } as Env).kind).toBe('mock');
    expect(resolveProviders({ AGENT_PROVIDER: 'none', AI: ai } as Env).chat).toBeNull();
    expect(resolveProviders({ AGENT_PROVIDER: 'openai-compatible', LLM_BASE_URL: 'https://x' } as Env).kind).toBe('none');
    expect(resolveProviders({ AGENT_PROVIDER: 'openai-compatible', LLM_BASE_URL: 'https://x', LLM_API_KEY: 'k', LLM_MODEL: 'm' } as Env).chat?.name).toBe('openai-compatible');
  });

  it('wire format for OpenAI omits tool names on tool messages', () => {
    expect(toWireMessages(conversation, 'openai')[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '[]' });
  });
});
