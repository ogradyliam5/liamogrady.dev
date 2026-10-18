/**
 * Deterministic offline "model" (AGENT_PROVIDER=mock) for local dev and tests. It exercises the
 * real tool-calling loop and both JSON pipelines without any network or Cloudflare account.
 */
import { SITE, search } from '../../shared/knowledge';
import { assessRoleFit } from '../assess';
import { firstSentence, truncate } from '../text';
import { uiForChunk } from './fallback';
import { fitCardFromAssessment, referenceArchitecture } from './pipelines';
import { ARCH_TASK_MARKER, FIT_TASK_MARKER, extractDelimited } from './prompts';
import type { ChatMessage, ChatRequest, ChatResult, Provider, ToolCall } from './types';

const JD_HINT = /\b(responsibilit|requirements|qualifications|we are looking for|you will|job description|about the role|essential|desirable)/i;
const PROBLEM_HINT = /\b(how would you (build|architect|design)|architecture for|we need (an?|to)|our (team|company|organisation|organization) (needs|wants)|sketch)/i;

export function looksLikeJobDescription(text: string): boolean {
  return text.length >= 300 && JD_HINT.test(text);
}

export function looksLikeProblem(text: string): boolean {
  return PROBLEM_HINT.test(text);
}

const tokens = (messages: ChatMessage[]) => Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 4);

export class MockProvider implements Provider {
  readonly name = 'mock';
  constructor(readonly model = 'mock') {}

  async chat(req: ChatRequest): Promise<ChatResult> {
    const inputTokens = tokens(req.messages);
    const system = req.messages.find((m) => m.role === 'system')?.content ?? '';
    const userIdx = req.messages.map((m) => m.role).lastIndexOf('user');
    const lastUser = req.messages[userIdx]?.content ?? '';

    if (req.json) {
      let text = '{}';
      if (system.includes(FIT_TASK_MARKER)) {
        const jd = extractDelimited(lastUser);
        const { basis: _b, note: _n, ...card } = fitCardFromAssessment(assessRoleFit(jd), jd);
        // Wrapped in prose and a code fence on purpose: the caller must extract it defensively.
        text = `Here is the assessment.\n\`\`\`json\n${JSON.stringify({ ...card, verdict: `(mock) ${card.verdict}` })}\n\`\`\``;
      } else if (system.includes(ARCH_TASK_MARKER)) {
        const problem = extractDelimited(lastUser);
        const { basis: _b, note: _n, ...card } = referenceArchitecture(problem);
        text = JSON.stringify({ ...card, title: `(mock) Sketch: ${truncate(problem, 60)}` });
      }
      return { text, toolCalls: [], usage: { inputTokens, outputTokens: Math.ceil(text.length / 4) } };
    }

    const toolResults = req.messages.slice(userIdx + 1).filter((m) => m.role === 'tool');
    if (req.tools?.length && toolResults.length === 0) {
      const calls = this.plan(lastUser);
      if (calls.length) return { text: '', toolCalls: calls, usage: { inputTokens, outputTokens: 20 * calls.length } };
    }
    const text = this.answer(lastUser, toolResults);
    return { text, toolCalls: [], usage: { inputTokens, outputTokens: Math.ceil(text.length / 4) } };
  }

  private plan(lastUser: string): ToolCall[] {
    if (looksLikeJobDescription(lastUser)) return [{ id: 'mock_0', name: 'assess_fit', args: { job_description: lastUser } }];
    if (looksLikeProblem(lastUser)) return [{ id: 'mock_0', name: 'sketch_architecture', args: { problem: lastUser } }];
    const calls: ToolCall[] = [{ id: 'mock_0', name: 'search_profile', args: { query: truncate(lastUser, 200) } }];
    const top = search(lastUser, 1)[0];
    if (top) {
      for (const [i, u] of uiForChunk(top).entries()) calls.push({ id: `mock_${i + 1}`, name: u.action, args: u.args });
    }
    return calls;
  }

  private answer(lastUser: string, toolResults: ChatMessage[]): string {
    for (const m of toolResults) {
      if (m.name === 'assess_fit' || m.name === 'sketch_architecture') return '(offline mock model) The card above has the details.';
      if (m.name !== 'search_profile') continue;
      try {
        const hits = JSON.parse(m.content) as { title: string; text: string; url: string }[];
        const top = hits[0];
        if (top) return `(offline mock model) From Liam's profile, ${top.title}: ${firstSentence(top.text, 220)} More at ${top.url}.`;
      } catch {
        /* fall through */
      }
    }
    const top = search(lastUser, 1)[0];
    if (top) return `(offline mock model) ${top.title}: ${firstSentence(top.text, 220)}`;
    return `(offline mock model) I couldn't find that in Liam's public profile. For anything more specific, request the full CV at ${SITE}/#contact.`;
  }
}
