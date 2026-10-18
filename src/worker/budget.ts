/**
 * Daily token budget for the on-site agent.
 *
 * One Durable Object instance ("ledger") counts the tokens the agent spends per UTC day, so the cap
 * holds across every Cloudflare location. Before each model call the agent checks what is left;
 * once the day's budget is spent it answers from the deterministic profile index instead, and the
 * visitor is told why. Rate limits per visitor still apply on top.
 *
 * Written as a plain class (no `cloudflare:workers` import), like Presence, so the Worker also loads
 * under Bun for scripts/dev.ts.
 */
import type { Env } from './env';
import { ProviderError } from './agent/providers';
import type { ChatRequest, ChatResult, Provider } from './agent/types';

/** Largest single increment accepted, so a bad caller cannot poison the counter. */
const MAX_INCREMENT = 1_000_000;

export const utcDay = (d: Date = new Date()): string => d.toISOString().slice(0, 10);

/** Minimal slice of DurableObjectStorage used here (easy to fake in tests). */
export interface LedgerStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  list<T>(): Promise<Map<string, T>>;
  delete(key: string): Promise<boolean>;
}

export class Budget {
  constructor(
    private readonly state: { storage: LedgerStorage },
    _env?: Env,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const day = utcDay(this.now());
    const used = (await this.state.storage.get<number>(day)) ?? 0;
    if (request.method === 'POST' && url.pathname === '/add') {
      const n = Math.floor(Number(url.searchParams.get('n')));
      const inc = Number.isFinite(n) ? Math.max(0, Math.min(MAX_INCREMENT, n)) : 0;
      const next = used + inc;
      await this.state.storage.put(day, next);
      if (used === 0) {
        // First write of a new day: drop earlier days' counters.
        for (const key of (await this.state.storage.list<number>()).keys()) if (key !== day) await this.state.storage.delete(key);
      }
      return Response.json({ day, used: next });
    }
    if (request.method === 'GET') return Response.json({ day, used });
    return new Response('Method not allowed', { status: 405 });
  }
}

export interface TokenMeter {
  /** Tokens left today (cached for the life of one agent request). */
  remaining(): Promise<number>;
  /** Records usage; the write happens in the background. */
  add(tokens: number): void;
}

/**
 * A meter backed by the BUDGET Durable Object, or null when the guard is off (no binding, or
 * AGENT_DAILY_TOKENS unset / 0). If the ledger cannot be read the meter fails closed: the agent
 * falls back to its deterministic answers rather than spending without a limit.
 */
export function dailyTokenMeter(env: Env, waitUntil: (p: Promise<unknown>) => void): TokenMeter | null {
  const limit = Math.floor(Number(env.AGENT_DAILY_TOKENS ?? 0));
  if (!env.BUDGET || !Number.isFinite(limit) || limit <= 0) return null;
  const stub = env.BUDGET.get(env.BUDGET.idFromName('ledger'));
  let used: number | null = null;
  return {
    async remaining() {
      if (used === null) {
        try {
          const res = await stub.fetch('https://budget/');
          const body = (await res.json()) as { used?: unknown };
          used = typeof body.used === 'number' && Number.isFinite(body.used) ? body.used : limit;
        } catch {
          used = limit;
        }
      }
      return limit - used;
    },
    add(tokens: number) {
      const n = Math.round(tokens);
      if (!(n > 0)) return;
      used = (used ?? 0) + n;
      waitUntil(stub.fetch(`https://budget/add?n=${n}`, { method: 'POST' }).catch(() => undefined));
    },
  };
}

/** Wraps a provider so every call is checked against, and recorded in, the daily budget. */
export class MeteredProvider implements Provider {
  readonly name: string;
  readonly model: string;
  constructor(
    private readonly inner: Provider,
    private readonly meter: TokenMeter,
  ) {
    this.name = inner.name;
    this.model = inner.model;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    if ((await this.meter.remaining()) <= 0) throw new ProviderError('Daily AI token budget reached', 'quota');
    const res = await this.inner.chat(req);
    this.meter.add(res.usage.inputTokens + res.usage.outputTokens);
    return res;
  }
}
