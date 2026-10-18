/** Server-sent events for the agent: every event is `data: <json>\n\n`. */
import type { AgentEvent } from './types';

export const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Accel-Buffering': 'no',
};

export function sseFrame(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export interface SseStream {
  readable: ReadableStream<Uint8Array>;
  send(event: AgentEvent): Promise<void>;
  close(): Promise<void>;
  /** True once the client has gone away (writes started failing). */
  readonly closed: boolean;
}

export function createSseStream(): SseStream {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let closed = false;
  return {
    readable,
    get closed() {
      return closed;
    },
    async send(event) {
      if (closed) return;
      try {
        await writer.write(encoder.encode(sseFrame(event)));
      } catch {
        closed = true;
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await writer.close();
      } catch {
        /* client already gone */
      }
    },
  };
}

/** A complete one-event stream (used for rate limiting before any work starts). */
export function sseOnce(event: AgentEvent, status: number, headers: Record<string, string> = {}): Response {
  return new Response(sseFrame(event), { status, headers: { ...SSE_HEADERS, ...headers } });
}

/** Splits text into small deltas (3-6 words each) whose concatenation is exactly the input. */
export function chunkText(text: string): string[] {
  const parts = text.match(/\S+\s*|\s+/g) ?? [];
  const out: string[] = [];
  let i = 0;
  let size = 3;
  while (i < parts.length) {
    out.push(parts.slice(i, i + size).join(''));
    i += size;
    size = size >= 6 ? 3 : size + 1;
  }
  return out;
}
