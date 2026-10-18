/**
 * Model providers behind one interface: chat({ messages, tools?, json?, maxTokens }) ->
 * { text, toolCalls: [{ id, name, args }], usage }.
 *
 *   openai             OpenAI Responses API: OPENAI_API_KEY (+ OPENAI_MODEL, default gpt-6-luna)
 *   workers-ai         env.AI binding (optionally through AI Gateway AI_GATEWAY_ID)
 *   openai-compatible  Chat Completions: LLM_BASE_URL + LLM_API_KEY + LLM_MODEL (Azure OpenAI, Foundry, others)
 *   mock               deterministic, offline (local dev and tests)
 *   none               no model: the agent answers from search() (fallback.ts)
 */
import type { AiBinding, Env } from '../env';
import { MockProvider } from './mock';
import type { ChatMessage, ChatRequest, ChatResult, Provider, ToolCall, ToolSpec, Usage } from './types';

export const DEFAULT_CHAT_MODEL = '@cf/zai-org/glm-4.7-flash';
export const DEFAULT_REASON_MODEL = '@cf/openai/gpt-oss-120b';
export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_OPENAI_MODEL = 'gpt-6-luna';

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'quota' | 'upstream',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** Workers AI neuron/quota exhaustion, upstream 429s and similar "come back later" failures. */
export function isQuotaError(err: unknown): boolean {
  if (err instanceof ProviderError && err.kind === 'quota') return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(3036|4006|429)\b|neurons?\b|daily (free )?(allocation|limit)|quota|budget|rate.?limit|capacity|limit (has been )?(exceeded|reached)/i.test(msg);
}

// ---------- response normalisation ----------

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function normalizeUsage(u: unknown): Usage {
  if (!u || typeof u !== 'object') return { inputTokens: 0, outputTokens: 0 };
  const x = u as Record<string, unknown>;
  return { inputTokens: num(x.prompt_tokens ?? x.input_tokens), outputTokens: num(x.completion_tokens ?? x.output_tokens) };
}

export function parseToolArgs(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === 'string' && v.trim()) {
    try {
      const parsed: unknown = JSON.parse(v);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function contentText(c: unknown): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((part) => {
        if (typeof part === 'string') return part;
        const p = part as { type?: unknown; text?: unknown };
        return p && typeof p.text === 'string' && p.type !== 'reasoning' && p.type !== 'reasoning_text' ? p.text : '';
      })
      .join('');
  }
  if (c && typeof c === 'object') return JSON.stringify(c);
  return '';
}

/** Removes <think>…</think> reasoning that some models emit inline. */
export function stripReasoning(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^[\s\S]*?<\/think>/i, '')
    .trim();
}

function toolCallsFrom(list: unknown): ToolCall[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((item, i) => {
    if (!item || typeof item !== 'object') return [];
    const t = item as Record<string, unknown>;
    const fn = t.function && typeof t.function === 'object' ? (t.function as Record<string, unknown>) : undefined;
    const name = typeof fn?.name === 'string' ? fn.name : typeof t.name === 'string' ? t.name : '';
    if (!name) return [];
    const args = parseToolArgs(fn ? fn.arguments : (t.arguments ?? t.args ?? t.parameters));
    const id = typeof t.id === 'string' && t.id ? t.id : typeof t.call_id === 'string' && t.call_id ? t.call_id : `call_${i}`;
    return [{ id, name, args }];
  });
}

/**
 * Normalises the response shapes we meet in practice:
 *  - OpenAI chat completions { choices: [{ message: { content, tool_calls: [{ id, type, function: { name, arguments } }] } }], usage }
 *    (newer Workers AI models, OpenAI, Azure OpenAI / Foundry)
 *  - classic Workers AI { response, tool_calls: [{ name, arguments }], usage }
 *  - OpenAI Responses { output: [{ type: "message" | "function_call", ... }], usage }
 */
export function normalizeAiResponse(raw: unknown): ChatResult {
  if (typeof raw === 'string') return { text: stripReasoning(raw), toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 } };
  if (!raw || typeof raw !== 'object') throw new ProviderError('Empty model response', 'upstream');
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.choices)) {
    const choice = (r.choices[0] ?? {}) as Record<string, unknown>;
    const msg = (choice.message ?? choice.delta ?? {}) as Record<string, unknown>;
    return { text: stripReasoning(contentText(msg.content)), toolCalls: toolCallsFrom(msg.tool_calls), usage: normalizeUsage(r.usage) };
  }
  if (Array.isArray(r.output)) {
    let text = typeof r.output_text === 'string' ? r.output_text : '';
    const calls: unknown[] = [];
    for (const item of r.output as Record<string, unknown>[]) {
      if (item?.type === 'message' && !r.output_text) text += contentText(item.content);
      if (item?.type === 'function_call') calls.push({ id: item.call_id ?? item.id, name: item.name, arguments: item.arguments });
    }
    return { text: stripReasoning(text), toolCalls: toolCallsFrom(calls), usage: normalizeUsage(r.usage) };
  }
  if ('response' in r || 'tool_calls' in r) {
    const resp = r.response;
    const text = typeof resp === 'string' ? resp : resp == null ? '' : JSON.stringify(resp);
    return { text: stripReasoning(text), toolCalls: toolCallsFrom(r.tool_calls), usage: normalizeUsage(r.usage) };
  }
  throw new ProviderError('Unrecognised model response shape', 'upstream');
}

// ---------- request shaping ----------

export function toWireMessages(messages: ChatMessage[], dialect: 'workers-ai' | 'openai'): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || '',
        tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args) } })),
      };
    }
    if (m.role === 'tool') {
      return dialect === 'workers-ai'
        ? { role: 'tool', tool_call_id: m.toolCallId, name: m.name, content: m.content }
        : { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    }
    return { role: m.role, content: m.content };
  });
}

export function toWireTools(tools: ToolSpec[]): Record<string, unknown>[] {
  return tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

// ---------- providers ----------

export class WorkersAiProvider implements Provider {
  readonly name = 'workers-ai';
  constructor(
    private readonly ai: AiBinding,
    readonly model: string,
    private readonly gatewayId?: string,
  ) {}

  async chat(req: ChatRequest): Promise<ChatResult> {
    const input: Record<string, unknown> = { messages: toWireMessages(req.messages, 'workers-ai'), max_tokens: req.maxTokens };
    if (req.tools?.length) input.tools = toWireTools(req.tools);
    let raw: unknown;
    try {
      raw = this.gatewayId ? await this.ai.run(this.model, input, { gateway: { id: this.gatewayId } }) : await this.ai.run(this.model, input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ProviderError(message, isQuotaError(err) ? 'quota' : 'upstream');
    }
    return normalizeAiResponse(raw);
  }
}

export interface OpenAiCompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** "authorization" (Bearer, OpenAI and Foundry) or "api-key" (Azure OpenAI). */
  authHeader?: string;
  /** Azure's api-version query parameter, when the endpoint needs one. */
  apiVersion?: string;
  /** "max_completion_tokens" (default) or "max_tokens" for older servers. */
  tokenParam?: string;
  fetcher?: typeof fetch;
}

export class OpenAiCompatibleProvider implements Provider {
  readonly name = 'openai-compatible';
  readonly model: string;
  constructor(private readonly cfg: OpenAiCompatibleConfig) {
    this.model = cfg.model;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const url = new URL(`${this.cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`);
    if (this.cfg.apiVersion) url.searchParams.set('api-version', this.cfg.apiVersion);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if ((this.cfg.authHeader || 'authorization').toLowerCase() === 'api-key') headers['api-key'] = this.cfg.apiKey;
    else headers.Authorization = `Bearer ${this.cfg.apiKey}`;
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages: toWireMessages(req.messages, 'openai'),
      [this.cfg.tokenParam || 'max_completion_tokens']: req.maxTokens,
    };
    if (req.tools?.length) {
      body.tools = toWireTools(req.tools);
      body.tool_choice = 'auto';
    }
    if (req.json) body.response_format = { type: 'json_object' };
    let res: Response;
    try {
      res = await (this.cfg.fetcher ?? fetch)(url.toString(), { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(25_000) });
    } catch (err) {
      throw new ProviderError(`LLM endpoint unreachable: ${err instanceof Error ? err.message : String(err)}`, 'upstream');
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw new ProviderError(`LLM endpoint returned ${res.status}${detail ? `: ${detail}` : ''}`, res.status === 429 ? 'quota' : 'upstream', res.status);
    }
    return normalizeAiResponse(await res.json());
  }
}

// ---------- OpenAI Responses API ----------

/** reasoning.effort values accepted by the GPT-6 family. */
export const REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** Reasoning tokens count towards max_output_tokens, so higher efforts get extra room. */
const REASONING_HEADROOM: Record<ReasoningEffort, number> = { none: 0, low: 1024, medium: 4096, high: 8192, xhigh: 16384, max: 32768 };

export function reasoningEffort(v: string | undefined, fallback: ReasoningEffort): ReasoningEffort {
  const e = (v ?? '').trim().toLowerCase();
  return (REASONING_EFFORTS as readonly string[]).includes(e) ? (e as ReasoningEffort) : fallback;
}

/**
 * Our chat transcript as Responses API input items. Requests are stateless (store: false), so the
 * whole turn is sent each time: tool calls go back as function_call items (without their output
 * item ids, so no reasoning item is required) followed by function_call_output items.
 */
export function toResponsesInput(messages: ChatMessage[]): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      items.push({ type: 'function_call_output', call_id: m.toolCallId ?? '', output: m.content });
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      if (m.content) items.push({ role: 'assistant', content: m.content });
      for (const tc of m.toolCalls) items.push({ type: 'function_call', call_id: tc.id, name: tc.name, arguments: JSON.stringify(tc.args) });
    } else {
      items.push({ role: m.role === 'system' ? 'developer' : m.role, content: m.content });
    }
  }
  return items;
}

/** Function tools in the Responses shape. strict is off: our schemas use optional properties. */
export function toResponsesTools(tools: ToolSpec[]): Record<string, unknown>[] {
  return tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: false }));
}

export interface OpenAiResponsesConfig {
  apiKey: string;
  model: string;
  /** Defaults to https://api.openai.com/v1. An AI Gateway URL ending in /openai also works. */
  baseUrl?: string;
  effort?: ReasoningEffort;
  fetcher?: typeof fetch;
}

/** OpenAI through the Responses API (function calling works at every reasoning effort). */
export class OpenAiResponsesProvider implements Provider {
  readonly name = 'openai';
  readonly model: string;
  readonly effort: ReasoningEffort;
  constructor(private readonly cfg: OpenAiResponsesConfig) {
    this.model = cfg.model;
    this.effort = cfg.effort ?? 'none';
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const url = `${(this.cfg.baseUrl || OPENAI_BASE_URL).replace(/\/+$/, '')}/responses`;
    const body: Record<string, unknown> = {
      model: this.model,
      input: toResponsesInput(req.messages),
      max_output_tokens: req.maxTokens + REASONING_HEADROOM[this.effort],
      reasoning: { effort: this.effort },
      store: false,
    };
    if (req.tools?.length) {
      body.tools = toResponsesTools(req.tools);
      body.tool_choice = 'auto';
    }
    if (req.json) body.text = { format: { type: 'json_object' } };
    let res: Response;
    try {
      res = await (this.cfg.fetcher ?? fetch)(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.cfg.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25_000),
      });
    } catch (err) {
      throw new ProviderError(`OpenAI unreachable: ${err instanceof Error ? err.message : String(err)}`, 'upstream');
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      const quota = res.status === 429 || /insufficient_quota|billing/i.test(detail);
      throw new ProviderError(`OpenAI returned ${res.status}${detail ? `: ${detail}` : ''}`, quota ? 'quota' : 'upstream', res.status);
    }
    const data = (await res.json()) as Record<string, unknown>;
    if (data && typeof data === 'object' && data.error) {
      throw new ProviderError(`OpenAI error: ${JSON.stringify(data.error).slice(0, 300)}`, 'upstream');
    }
    return normalizeAiResponse(data);
  }
}

export interface ResolvedProviders {
  /** The configured provider kind ("none" when nothing usable is configured). */
  kind: string;
  chat: Provider | null;
  reason: Provider | null;
}

export function resolveProviders(env: Env, fetcher?: typeof fetch): ResolvedProviders {
  const kind = (env.AGENT_PROVIDER || 'workers-ai').trim().toLowerCase();
  if (kind === 'openai' && env.OPENAI_API_KEY?.trim()) {
    const base = { apiKey: env.OPENAI_API_KEY.trim(), baseUrl: env.OPENAI_BASE_URL?.trim() || OPENAI_BASE_URL, fetcher };
    const model = env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
    return {
      kind,
      // Tool-calling chat: no reasoning, for speed and cost. Fit checks and sketches: a little.
      chat: new OpenAiResponsesProvider({ ...base, model, effort: reasoningEffort(env.OPENAI_REASONING_CHAT, 'none') }),
      reason: new OpenAiResponsesProvider({ ...base, model: env.OPENAI_MODEL_REASON?.trim() || model, effort: reasoningEffort(env.OPENAI_REASONING_ANALYSIS, 'low') }),
    };
  }
  if (kind === 'workers-ai' && env.AI) {
    const gateway = env.AI_GATEWAY_ID?.trim() || undefined;
    return {
      kind,
      chat: new WorkersAiProvider(env.AI, env.AGENT_MODEL_CHAT || DEFAULT_CHAT_MODEL, gateway),
      reason: new WorkersAiProvider(env.AI, env.AGENT_MODEL_REASON || DEFAULT_REASON_MODEL, gateway),
    };
  }
  if (kind === 'openai-compatible' && env.LLM_BASE_URL && env.LLM_API_KEY && env.LLM_MODEL) {
    const base = { baseUrl: env.LLM_BASE_URL, apiKey: env.LLM_API_KEY, authHeader: env.LLM_AUTH_HEADER, apiVersion: env.LLM_API_VERSION, tokenParam: env.LLM_TOKEN_PARAM, fetcher };
    return {
      kind,
      chat: new OpenAiCompatibleProvider({ ...base, model: env.LLM_MODEL }),
      reason: new OpenAiCompatibleProvider({ ...base, model: env.LLM_MODEL_REASON || env.LLM_MODEL }),
    };
  }
  if (kind === 'mock') return { kind, chat: new MockProvider('mock-chat'), reason: new MockProvider('mock-reason') };
  return { kind: 'none', chat: null, reason: null };
}
