/** Strict validation and hardening of POST /api/agent bodies. */
import { z } from 'zod';
import { cleanText } from '../text';
import { NAV_SECTIONS } from './tools';
import type { AgentMode, ChatTurn } from './types';

export const MAX_MESSAGES = 12;
export const MAX_MESSAGE_CHARS = 4000;
export const MAX_USER_CHARS = 12_000;
/** Whole-conversation budget (~6k tokens); beyond it the agent answers with error code "budget". */
export const MAX_CONVERSATION_CHARS = 24_000;

const MessageSchema = z.strictObject({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(MAX_MESSAGE_CHARS, `Each message is limited to ${MAX_MESSAGE_CHARS} characters.`),
});

const AgentRequestSchema = z.strictObject({
  messages: z.array(MessageSchema).min(1, 'Send at least one message.').max(MAX_MESSAGES, `Send at most ${MAX_MESSAGES} messages.`),
  mode: z.enum(['chat', 'fit', 'architect']).optional(),
  section: z
    .string()
    .regex(/^[a-z0-9-]{1,32}$/, 'Unknown section.')
    .optional(),
  turnstile: z.string().max(2048).optional(),
});

export interface AgentRequest {
  messages: ChatTurn[];
  mode: AgentMode;
  /** The section the visitor is looking at, when it is one the agent knows. */
  section: string | null;
  turnstile: string | null;
}

export type AgentValidation = { ok: true; value: AgentRequest } | { ok: false; field: string; message: string };

export function validateAgentRequest(input: unknown): AgentValidation {
  const r = AgentRequestSchema.safeParse(input);
  if (!r.success) {
    const issue = r.error.issues[0];
    const field = issue?.path.length ? issue.path.join('.') : 'body';
    const message = issue?.code === 'unrecognized_keys' ? 'Unexpected field.' : issue?.message ?? 'Invalid request.';
    return { ok: false, field, message };
  }
  const raw = r.data.messages;
  const userChars = raw.filter((m) => m.role === 'user').reduce((n, m) => n + m.content.length, 0);
  if (userChars > MAX_USER_CHARS) return { ok: false, field: 'messages', message: `Your messages are limited to ${MAX_USER_CHARS} characters in total.` };

  const messages: ChatTurn[] = [];
  for (const [i, m] of raw.entries()) {
    const content = cleanText(m.content);
    if (!content) return { ok: false, field: `messages.${i}.content`, message: 'Messages cannot be empty.' };
    messages.push({ role: m.role, content });
  }
  if (messages[messages.length - 1]?.role !== 'user') return { ok: false, field: 'messages', message: 'The last message must come from the user.' };

  const section = r.data.section && (NAV_SECTIONS as readonly string[]).includes(r.data.section) ? r.data.section : null;
  return { ok: true, value: { messages, mode: r.data.mode ?? 'chat', section, turnstile: r.data.turnstile ?? null } };
}

export function conversationChars(messages: ChatTurn[]): number {
  return messages.reduce((n, m) => n + m.content.length, 0);
}

export function lastUserMessage(messages: ChatTurn[]): string {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.role === 'user') return messages[i]!.content;
  return '';
}
