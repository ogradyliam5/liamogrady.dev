/** Shared types for the on-site agent (POST /api/agent). The SSE contract is documented in docs/WORKER.md. */

export type AgentMode = 'chat' | 'fit' | 'architect';
export type UiAction = 'navigate' | 'highlight' | 'scene' | 'open_xray';
export type ErrorCode = 'rate_limited' | 'bad_request' | 'upstream' | 'budget';
export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export type AgentEvent =
  | { type: 'meta'; requestId: string; provider: string; model: string; colo: string; mode: AgentMode; fallback: boolean }
  | { type: 'status'; text: string }
  | { type: 'tool'; id: string; name: string; args: Record<string, unknown>; kind: 'data' | 'ui' }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; summary: string }
  | { type: 'ui'; action: UiAction; args: Record<string, unknown> }
  | { type: 'card'; kind: 'fit' | 'architecture' | 'sources'; data: unknown }
  | { type: 'text'; delta: string }
  | { type: 'done'; usage: Usage; latencyMs: number; steps: number; model: string }
  | { type: 'error'; code: ErrorCode; message: string };

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  /** Ask for a single JSON object (instruction-level; parsed defensively by the caller). */
  json?: boolean;
  maxTokens: number;
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
}

export interface Provider {
  readonly name: string;
  readonly model: string;
  chat(req: ChatRequest): Promise<ChatResult>;
}

export interface SourceRef {
  id: string;
  title: string;
  url: string;
  section: string;
}
