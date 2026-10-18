import { describe, expect, it } from 'vitest';
import { Budget, MeteredProvider, dailyTokenMeter, utcDay, type LedgerStorage, type TokenMeter } from '../../src/worker/budget';
import { ProviderError, isQuotaError } from '../../src/worker/agent/providers';
import { runAgent } from '../../src/worker/agent/run';
import type { AgentEvent, ChatRequest, ChatResult, Provider } from '../../src/worker/agent/types';
import type { Env } from '../../src/worker/env';

function memoryStorage(): LedgerStorage & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get<T>(k: string) {
      return data.get(k) as T | undefined;
    },
    async put<T>(k: string, v: T) {
      data.set(k, v);
    },
    async list<T>() {
      return new Map([...data.entries()]) as Map<string, T>;
    },
    async delete(k: string) {
      return data.delete(k);
    },
  };
}

/** A DurableObjectNamespace stand-in that routes every stub to one Budget instance. */
function budgetNamespace(budget: Budget) {
  const stub = { fetch: (input: string, init?: RequestInit) => budget.fetch(new Request(input, init)) };
  return { idFromName: () => ({}), get: () => stub } as unknown as DurableObjectNamespace;
}

class CountingProvider implements Provider {
  readonly name = 'openai';
  readonly model = 'gpt-6-luna';
  calls = 0;
  async chat(_req: ChatRequest): Promise<ChatResult> {
    this.calls++;
    return { text: 'Liam builds MCP servers.', toolCalls: [], usage: { inputTokens: 900, outputTokens: 100 } };
  }
}

describe('Budget ledger', () => {
  it('counts tokens per UTC day and forgets earlier days', async () => {
    const storage = memoryStorage();
    let now = new Date('2026-10-10T23:59:00Z');
    const b = new Budget({ storage }, undefined, () => now);
    expect(await (await b.fetch(new Request('https://budget/'))).json()).toEqual({ day: '2026-10-10', used: 0 });
    await b.fetch(new Request('https://budget/add?n=1500', { method: 'POST' }));
    const r = await (await b.fetch(new Request('https://budget/add?n=250', { method: 'POST' }))).json();
    expect(r).toEqual({ day: '2026-10-10', used: 1750 });

    now = new Date('2026-10-11T00:01:00Z');
    expect(await (await b.fetch(new Request('https://budget/'))).json()).toEqual({ day: '2026-10-11', used: 0 });
    await b.fetch(new Request('https://budget/add?n=10', { method: 'POST' }));
    expect([...storage.data.keys()]).toEqual(['2026-10-11']);
  });

  it('ignores bad increments and other methods', async () => {
    const b = new Budget({ storage: memoryStorage() });
    await b.fetch(new Request('https://budget/add?n=-50', { method: 'POST' }));
    await b.fetch(new Request('https://budget/add?n=abc', { method: 'POST' }));
    const huge = await (await b.fetch(new Request('https://budget/add?n=999999999', { method: 'POST' }))).json();
    expect((huge as { used: number }).used).toBe(1_000_000);
    expect((await b.fetch(new Request('https://budget/', { method: 'DELETE' }))).status).toBe(405);
    expect(utcDay(new Date('2026-01-02T03:04:05Z'))).toBe('2026-01-02');
  });
});

describe('dailyTokenMeter + MeteredProvider', () => {
  it('is off without a binding or a positive limit', () => {
    const ns = budgetNamespace(new Budget({ storage: memoryStorage() }));
    expect(dailyTokenMeter({} as Env, () => {})).toBeNull();
    expect(dailyTokenMeter({ BUDGET: ns } as Env, () => {})).toBeNull();
    expect(dailyTokenMeter({ BUDGET: ns, AGENT_DAILY_TOKENS: '0' } as Env, () => {})).toBeNull();
    expect(dailyTokenMeter({ BUDGET: ns, AGENT_DAILY_TOKENS: 'lots' } as Env, () => {})).toBeNull();
  });

  it('records usage and stops calling the model once the day is spent', async () => {
    const storage = memoryStorage();
    const ns = budgetNamespace(new Budget({ storage }));
    const env = { BUDGET: ns, AGENT_DAILY_TOKENS: '1500' } as Env;
    const pending: Promise<unknown>[] = [];
    const inner = new CountingProvider();

    const first = new MeteredProvider(inner, dailyTokenMeter(env, (p) => pending.push(p))!);
    expect(first.model).toBe('gpt-6-luna');
    await first.chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 100 });
    await Promise.all(pending);
    expect(storage.data.get(utcDay())).toBe(1000);

    // Same request: the cached count already includes the first call, 500 tokens are left.
    await first.chat({ messages: [{ role: 'user', content: 'again' }], maxTokens: 100 });
    await Promise.all(pending);
    expect(storage.data.get(utcDay())).toBe(2000);

    // A new request reads the ledger and finds nothing left.
    const next = new MeteredProvider(inner, dailyTokenMeter(env, (p) => pending.push(p))!);
    const err = await next.chat({ messages: [{ role: 'user', content: 'more' }], maxTokens: 100 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(isQuotaError(err)).toBe(true);
    expect(inner.calls).toBe(2);
  });

  it('fails closed when the ledger cannot be read', async () => {
    const broken = { idFromName: () => ({}), get: () => ({ fetch: async () => { throw new Error('DO unavailable'); } }) } as unknown as DurableObjectNamespace;
    const meter = dailyTokenMeter({ BUDGET: broken, AGENT_DAILY_TOKENS: '1000' } as Env, () => {})!;
    expect(await meter.remaining()).toBe(0);
  });

  it('makes the agent answer from the profile index when the budget is spent', async () => {
    const spent: TokenMeter = { remaining: async () => 0, add: () => {} };
    const inner = new CountingProvider();
    const events: AgentEvent[] = [];
    await runAgent({
      request: { messages: [{ role: 'user', content: 'Has Liam built any MCP servers?' }], mode: 'chat', section: null, turnstile: null } as never,
      chat: new MeteredProvider(inner, spent),
      reason: new MeteredProvider(inner, spent),
      providerKind: 'openai',
      colo: 'LHR',
      requestId: 'test',
      emit: (e) => {
        events.push(e);
      },
      today: '10 October 2026',
    });
    expect(inner.calls).toBe(0);
    const metas = events.filter((e) => e.type === 'meta');
    expect(metas.at(-1)).toMatchObject({ provider: 'openai', fallback: true });
    expect(events.some((e) => e.type === 'status' && /budget is used up/i.test(e.text))).toBe(true);
    expect(events.some((e) => e.type === 'text')).toBe(true);
    expect(events.at(-1)?.type).toBe('done');
  });
});
