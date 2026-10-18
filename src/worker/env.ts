/**
 * Bindings and configuration for the liamogrady.dev Worker (wrangler.jsonc, docs/WORKER.md).
 * Binding types are kept minimal on purpose so the same Worker also runs under Bun
 * (scripts/dev.ts + scripts/local-env.ts) with simple stand-ins, where most bindings are absent.
 */

/** The slice of the Workers AI binding we use. */
export interface AiBinding {
  run(model: string, input: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

/** Workers Rate Limiting binding. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Static assets binding (Workers Static Assets, or the Bun dev stand-in). */
export interface AssetsBinding {
  fetch(input: Request | string): Promise<Response>;
}

/** Stand-in for request.cf when running outside Cloudflare (set by scripts/dev.ts). */
export interface LocalCf {
  colo?: string;
  country?: string;
  city?: string;
}

export interface Env {
  ASSETS?: AssetsBinding;
  AI?: AiBinding;
  PRESENCE?: DurableObjectNamespace;
  /** Daily token ledger for the on-site agent (src/worker/budget.ts). */
  BUDGET?: DurableObjectNamespace;
  RL_AI?: RateLimiter;
  RL_MCP?: RateLimiter;
  RL_CONTACT?: RateLimiter;

  SITE_URL?: string;
  ALLOWED_HOSTS?: string;

  AGENT_PROVIDER?: string;
  AGENT_MODEL_CHAT?: string;
  AGENT_MODEL_REASON?: string;
  AI_GATEWAY_ID?: string;
  AGENT_REQUIRE_TURNSTILE?: string;
  /** Tokens (input + output) the agent may spend per UTC day; "0" or empty turns the guard off. */
  AGENT_DAILY_TOKENS?: string;

  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  OPENAI_MODEL_REASON?: string;
  OPENAI_REASONING_CHAT?: string;
  OPENAI_REASONING_ANALYSIS?: string;

  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
  LLM_MODEL_REASON?: string;
  LLM_AUTH_HEADER?: string;
  LLM_API_VERSION?: string;
  LLM_TOKEN_PARAM?: string;

  CONTACT_DELIVERY?: string;
  CONTACT_TO?: string;
  CONTACT_WEBHOOK_URL?: string;
  GRAPH_TENANT_ID?: string;
  GRAPH_CLIENT_ID?: string;
  GRAPH_CLIENT_SECRET?: string;
  GRAPH_SENDER?: string;

  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;

  __cfLocal?: LocalCf;
}
