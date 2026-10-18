/**
 * The on-site agent's orchestration, independent of HTTP: everything it does is reported through
 * `emit(event)`, so tests can run it with the mock provider and inspect the event sequence.
 *
 * chat       grounded tool loop (max 4 tool steps, then a final answer), text in small deltas
 * fit        role-fit pipeline on the latest message -> fit card + 2-3 sentence summary
 * architect  architecture pipeline -> architecture card + summary + "starting point" reminder
 * Any model failure (or no model) falls back to deterministic answers from search().
 */
import { search, type Chunk } from '../../shared/knowledge';
import { corpus } from '../assess';
import { sectionChunkIds, sectionMarkdown, type ProfileSection } from '../sections';
import { truncate } from '../text';
import { fallbackAnswer, type FallbackAnswer } from './fallback';
import { architectureSummary, fitSummary, runArchitecturePipeline, runFitPipeline } from './pipelines';
import { chatSystemPrompt } from './prompts';
import { isQuotaError } from './providers';
import { chunkText } from './sse';
import { AGENT_TOOLS, MAX_JD, MAX_PROBLEM, TOOL_ARGS, isToolName, toolKind } from './tools';
import type { AgentEvent, ChatMessage, Provider, SourceRef, ToolCall, UiAction, Usage } from './types';
import { MAX_CONVERSATION_CHARS, conversationChars, lastUserMessage, type AgentRequest } from './validate';

export const MAX_TOOL_STEPS = 4;
export const MAX_CALLS_PER_STEP = 4;
const CHAT_MAX_TOKENS = 700;

export interface RunAgentOptions {
  request: AgentRequest;
  chat: Provider | null;
  reason: Provider | null;
  /** Configured provider kind, reported in meta. */
  providerKind: string;
  colo: string;
  requestId: string;
  emit: (event: AgentEvent) => void | Promise<void>;
  clock?: () => number;
  today?: string;
}

/** A friendlier status line when the model answered but its JSON did not validate. */
function invalidOutput(err: unknown, text: string): string | undefined {
  return err instanceof Error && /unparseable/.test(err.message) ? text : undefined;
}

function chunkById(id: string): Chunk | undefined {
  return corpus().find((c) => c.id === id);
}

/** Prefer the visitor's own text over a model's paraphrase of it. */
function verbatim(arg: string, lastUser: string, max: number): string {
  const text = lastUser.length >= 200 && lastUser.length > arg.length * 1.5 ? lastUser : arg;
  return text.slice(0, max);
}

export async function runAgent(o: RunAgentOptions): Promise<void> {
  const clock = o.clock ?? (() => performance.now());
  const t0 = clock();
  const { request } = o;
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const sources = new Map<string, SourceRef>();
  const primary = request.mode === 'chat' ? o.chat : o.reason;
  let steps = 0;
  let fallback = !primary;
  let model = primary?.model ?? 'deterministic';
  const lastUser = lastUserMessage(request.messages);
  const today = o.today ?? new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const emit = async (e: AgentEvent) => {
    await o.emit(e);
  };
  const addUsage = (u: Usage) => {
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;
  };
  const cite = (chunks: (Pick<Chunk, 'id' | 'title' | 'url' | 'section'> | undefined)[]) => {
    for (const c of chunks) if (c && !sources.has(c.id)) sources.set(c.id, { id: c.id, title: c.title, url: c.url, section: c.section });
  };
  const meta = () =>
    emit({ type: 'meta', requestId: o.requestId, provider: o.providerKind, model, colo: o.colo, mode: request.mode, fallback });
  const switchToFallback = async (err: unknown, why?: string) => {
    if (fallback) return;
    fallback = true;
    model = 'deterministic';
    const text =
      why ??
      (isQuotaError(err)
        ? "Today's AI budget is used up, so this answer comes from Liam's profile index."
        : "The live model didn't answer, so this comes from Liam's profile index.");
    await emit({ type: 'status', text });
    await meta(); // re-sent with fallback: true
  };
  const sendText = async (text: string) => {
    for (const delta of chunkText(text)) await emit({ type: 'text', delta });
  };
  const finish = async () => {
    await emit({ type: 'card', kind: 'sources', data: { sources: [...sources.values()].slice(0, 8) } });
    await emit({ type: 'done', usage, latencyMs: Math.round(clock() - t0), steps, model });
  };
  const emitUi = async (ui: FallbackAnswer['ui']) => {
    for (const u of ui) await emit({ type: 'ui', action: u.action, args: u.args });
  };

  await meta();

  if (conversationChars(request.messages) > MAX_CONVERSATION_CHARS) {
    await emit({ type: 'error', code: 'budget', message: 'This conversation is too long for the AI budget. Start a new chat to keep going.' });
    return;
  }

  // ---------- fit ----------
  if (request.mode === 'fit') {
    if (lastUser.length < 40) {
      await emit({ type: 'error', code: 'bad_request', message: 'Paste a job description (a few lines at least) to assess the fit.' });
      return;
    }
    await emit({ type: 'status', text: fallback ? 'Matching the job description against the profile…' : 'Assessing the fit against Liam’s profile…' });
    const run = await runFitPipeline(fallback ? null : o.reason, lastUser.slice(0, MAX_JD));
    steps += run.calls;
    addUsage(run.usage);
    if (run.error) await switchToFallback(run.error, invalidOutput(run.error, "The model's answer didn't validate, so this card uses keyword evidence instead."));
    cite(run.evidence);
    cite(run.card.requirements.map((r) => (r.source ? chunkById(r.source) : undefined)));
    await emit({ type: 'card', kind: 'fit', data: run.card });
    await sendText(fitSummary(run.card));
    await finish();
    return;
  }

  // ---------- architect ----------
  if (request.mode === 'architect') {
    if (lastUser.length < 20) {
      await emit({ type: 'error', code: 'bad_request', message: 'Describe the problem in a sentence or two to get a sketch.' });
      return;
    }
    await emit({ type: 'status', text: 'Sketching an architecture…' });
    const run = await runArchitecturePipeline(fallback ? null : o.reason, lastUser.slice(0, MAX_PROBLEM));
    steps += run.calls;
    addUsage(run.usage);
    if (run.error) await switchToFallback(run.error, invalidOutput(run.error, "The model's sketch didn't validate, so here is the reference architecture instead."));
    cite(run.evidence);
    await emit({ type: 'card', kind: 'architecture', data: run.card });
    await sendText(architectureSummary(run.card));
    await finish();
    return;
  }

  // ---------- chat ----------
  const answerFromIndex = async (intro?: string) => {
    const fb = intro ? fallbackAnswer(lastUser, intro) : fallbackAnswer(lastUser);
    cite(fb.hits);
    await emitUi(fb.ui);
    await sendText(fb.text);
    await finish();
  };
  if (fallback || !o.chat) {
    await answerFromIndex();
    return;
  }
  const chat = o.chat;

  const executeTool = async (call: ToolCall): Promise<string> => {
    const { id, name } = call;
    await emit({ type: 'tool', id, name, args: call.args, kind: toolKind(name) });
    const result = (ok: boolean, summary: string) => emit({ type: 'tool_result', id, name, ok, summary: truncate(summary, 160) });
    if (!isToolName(name)) {
      await result(false, 'Unknown tool');
      return `Error: there is no tool called ${truncate(name, 40)}.`;
    }
    const parsed = TOOL_ARGS[name].safeParse(call.args);
    if (!parsed.success) {
      await result(false, 'Invalid arguments');
      return `Error: invalid arguments for ${name}.`;
    }
    const args = parsed.data as Record<string, unknown>;
    switch (name) {
      case 'navigate':
      case 'highlight':
      case 'scene':
      case 'open_xray':
        // UI tools run in the browser; the server treats them as instantly successful.
        await emit({ type: 'ui', action: name as UiAction, args });
        await result(true, 'Done');
        return 'ok';
      case 'search_profile': {
        await emit({ type: 'status', text: "Searching Liam's profile…" });
        const hits = search(String(args.query), 4);
        cite(hits);
        await result(true, hits.length ? `${hits.length} results: ${hits.map((h) => h.title).join(', ')}` : 'No results');
        return JSON.stringify(hits.map((h) => ({ id: h.id, title: h.title, text: truncate(h.text, 600), url: h.url })));
      }
      case 'get_section': {
        const section = args.name as ProfileSection;
        await emit({ type: 'status', text: `Reading the ${section} section…` });
        cite(sectionChunkIds(section).map(chunkById));
        await result(true, `Read the ${section} section`);
        return truncate(sectionMarkdown(section), 4000);
      }
      case 'assess_fit': {
        await emit({ type: 'status', text: 'Assessing the fit…' });
        const run = await runFitPipeline(o.reason, verbatim(String(args.job_description), lastUser, MAX_JD));
        steps += run.calls;
        addUsage(run.usage);
        cite(run.evidence);
        await emit({ type: 'card', kind: 'fit', data: run.card });
        await result(true, `Fit ${run.card.overall}/100 (${run.card.basis})`);
        const { role, overall, verdict, strengths, gaps, basis } = run.card;
        return JSON.stringify({ shownToVisitor: 'fit card', role, overall, verdict, strengths, gaps, basis });
      }
      case 'sketch_architecture': {
        await emit({ type: 'status', text: 'Sketching an architecture…' });
        const run = await runArchitecturePipeline(o.reason, verbatim(String(args.problem), lastUser, MAX_PROBLEM));
        steps += run.calls;
        addUsage(run.usage);
        cite(run.evidence);
        await emit({ type: 'card', kind: 'architecture', data: run.card });
        await result(true, `Architecture sketch (${run.card.basis})`);
        return JSON.stringify({ shownToVisitor: 'architecture card', title: run.card.title, summary: run.card.summary, layers: run.card.layers.map((l) => l.name), basis: run.card.basis });
      }
    }
  };

  const seed = search(lastUser, 4);
  cite(seed);
  await emit({ type: 'status', text: 'Thinking…' });
  const messages: ChatMessage[] = [
    { role: 'system', content: chatSystemPrompt({ evidence: seed, section: request.section, today }) },
    ...request.messages.map((m): ChatMessage => ({ role: m.role, content: m.content })),
  ];

  let finalText: string | null = null;
  try {
    for (let step = 0; step < MAX_TOOL_STEPS; step++) {
      const res = await chat.chat({ messages, tools: AGENT_TOOLS, maxTokens: CHAT_MAX_TOKENS });
      steps++;
      addUsage(res.usage);
      if (!res.toolCalls.length) {
        finalText = res.text;
        break;
      }
      messages.push({ role: 'assistant', content: res.text, toolCalls: res.toolCalls });
      for (const [i, call] of res.toolCalls.entries()) {
        const content = i < MAX_CALLS_PER_STEP ? await executeTool(call) : 'Skipped: too many tool calls in one step.';
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content });
      }
    }
    if (finalText === null) {
      await emit({ type: 'status', text: 'Writing the answer…' });
      messages.push({ role: 'user', content: 'Answer the visitor now, in 2-6 sentences, using the tool results above. Do not call any more tools.' });
      const res = await chat.chat({ messages, maxTokens: CHAT_MAX_TOKENS });
      steps++;
      addUsage(res.usage);
      finalText = res.text;
    }
  } catch (err) {
    await switchToFallback(err);
    await answerFromIndex();
    return;
  }

  const text = finalText.trim();
  if (!text) {
    await answerFromIndex("Here's what Liam's public profile says:");
    return;
  }
  await sendText(text);
  await finish();
}
