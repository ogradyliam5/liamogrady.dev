/**
 * Deterministic "offline" agent: answers from the public profile with plain retrieval,
 * no model. Used when the live agent is unreachable (static preview, outage, budget spent),
 * and shaped exactly like the live SSE events so the UI renders it the same way.
 */
import { search, chunks, type Chunk } from './knowledge';

export type AgentEvent =
  | { type: 'meta'; requestId: string; provider: string; model: string; colo: string; mode: string; fallback: boolean }
  | { type: 'status'; text: string }
  | { type: 'tool'; id: string; name: string; args: unknown; kind: 'data' | 'ui' }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; summary: string }
  | { type: 'ui'; action: 'navigate' | 'highlight' | 'scene' | 'open_xray'; args: Record<string, string> }
  | { type: 'card'; kind: 'fit' | 'architecture' | 'sources'; data: unknown }
  | { type: 'text'; delta: string }
  | { type: 'done'; usage: { inputTokens: number; outputTokens: number }; latencyMs: number; steps: number; model: string }
  | { type: 'error'; code: string; message: string };

const SECTION_SCENE: Record<string, string> = {
  about: 'fields',
  capabilities: 'graph',
  work: 'constellation',
  journey: 'journey',
  credentials: 'badges',
  writing: 'drift',
  agents: 'globe',
  contact: 'signoff',
};

function highlightFor(c: Chunk): string | null {
  if (c.id.startsWith('project-')) return `project:${c.id.slice(8)}`;
  if (c.id.startsWith('role-')) return `role:${c.id.slice(5)}`;
  if (c.id.startsWith('cap-')) return `cap:${c.id.slice(4)}`;
  return null;
}

function firstSentences(text: string, n = 2): string {
  const parts = text.replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+/g) ?? [text];
  return parts.slice(0, n).join(' ').trim();
}

export function offlineChat(question: string): AgentEvent[] {
  const hits = search(question, 4);
  const ev: AgentEvent[] = [];
  ev.push({ type: 'tool', id: 't1', name: 'search_profile', args: { query: question.slice(0, 120) }, kind: 'data' });
  ev.push({ type: 'tool_result', id: 't1', name: 'search_profile', ok: true, summary: `${hits.length} matches` });
  if (!hits.length) {
    ev.push({
      type: 'text',
      delta: "I couldn't find that in Liam's public profile. It may be in his full CV: use the contact form to ask for it, or try asking about his experience, projects or certifications.",
    });
    return ev;
  }
  const top = hits[0]!;
  ev.push({ type: 'ui', action: 'navigate', args: { section: top.section } });
  const hl = highlightFor(top);
  if (hl) ev.push({ type: 'ui', action: 'highlight', args: { target: hl } });
  const body = (h: Chunk) => (h.text.startsWith(h.title) ? h.text.slice(h.title.length).replace(/^\s*(\([^)]*\))?\s*:?\s*/, '') : h.text);
  const lines = hits.slice(0, 3).map((h) => `- **${h.title}**: ${firstSentences(body(h), 2)}`);
  ev.push({ type: 'text', delta: `Here's what Liam's profile says:\n\n${lines.join('\n')}` });
  ev.push({ type: 'card', kind: 'sources', data: { items: hits.slice(0, 4).map((h) => ({ title: h.title, url: h.url })) } });
  return ev;
}

/** Requirement-by-requirement coverage of a pasted job description, from retrieval scores. */
export function assessFit(jd: string) {
  const lines = jd
    .split(/\n|•|;|(?<=\.)\s+(?=[A-Z])/)
    .map((l) => l.replace(/^[\s\-*\d.)]+/, '').trim())
    .filter((l) => l.length > 12 && l.length < 300);
  const reqs = [...new Set(lines)].slice(0, 10);
  const rows = reqs.map((requirement) => {
    const hit = search(requirement, 1)[0];
    const score = hit?.score ?? 0;
    const match: 'strong' | 'partial' | 'gap' = score > 6 ? 'strong' : score > 2.5 ? 'partial' : 'gap';
    return {
      requirement,
      match,
      evidence: hit && match !== 'gap' ? `${hit.title}: ${firstSentences(hit.text, 1)}` : 'No direct evidence in the public profile.',
      source: hit?.id ?? '',
    };
  });
  const weights = { strong: 1, partial: 0.5, gap: 0 } as const;
  const overall = rows.length ? Math.round((rows.reduce((s, r) => s + weights[r.match], 0) / rows.length) * 100) : 0;
  const titleLine = jd.split('\n').map((l) => l.trim()).find((l) => l.length > 3 && l.length < 90) ?? 'The role';
  return {
    role: titleLine,
    company: null,
    overall,
    verdict:
      overall >= 70
        ? 'Strong overlap with the public profile; worth a conversation.'
        : overall >= 40
          ? 'Partial overlap; the full CV will fill in detail the public profile leaves out.'
          : 'Limited overlap with what is public; the full CV may show more.',
    strengths: rows.filter((r) => r.match === 'strong').map((r) => r.requirement).slice(0, 5),
    requirements: rows,
    gaps: rows.filter((r) => r.match === 'gap').map((r) => r.requirement).slice(0, 4),
    questions: ['What does success look like in the first 90 days?', 'Which parts of the Microsoft stack are already in place?'],
  };
}

export const REFERENCE_ARCHITECTURE = {
  title: 'Enterprise Copilot Studio agent: reference sketch',
  problem: 'A governed, tool-using agent on the Microsoft stack',
  summary:
    'A Copilot Studio agent published to Microsoft 365 Copilot and Teams, grounded in curated knowledge, acting through Power Platform connectors and MCP servers, with Dataverse for state and Purview and Managed Environments for governance.',
  layers: [
    { name: 'Channels', components: [{ name: 'Microsoft 365 Copilot & Teams', tech: 'Copilot Studio channels', purpose: 'Meet people where they already work' }] },
    { name: 'Orchestration', components: [{ name: 'Generative orchestration', tech: 'Copilot Studio', purpose: 'Plans steps, picks tools and topics, asks for missing details' }] },
    { name: 'Agents', components: [{ name: 'Specialist child agents', tech: 'Copilot Studio / Microsoft Foundry', purpose: 'Keep each domain small, testable and owned' }] },
    { name: 'Tools & connectors', components: [
      { name: 'Line-of-business actions', tech: 'Power Platform connectors, Power Automate', purpose: 'Create, update and route work items' },
      { name: 'MCP servers', tech: 'Model Context Protocol', purpose: 'Reusable tool surfaces across agents' },
    ] },
    { name: 'Data & knowledge', components: [
      { name: 'Curated knowledge', tech: 'SharePoint, Dataverse', purpose: 'Authoritative, permission-trimmed grounding' },
      { name: 'Conversation state', tech: 'Dataverse', purpose: 'Hand-offs, audit and analytics' },
    ] },
    { name: 'Governance & operations', components: [
      { name: 'Guardrails', tech: 'Managed Environments, DLP, Purview', purpose: 'Data boundaries and compliance' },
      { name: 'ALM & telemetry', tech: 'Pipelines, Application Insights', purpose: 'Safe releases and measurable outcomes' },
    ] },
  ],
  flow: [
    'User asks in Teams or Microsoft 365 Copilot',
    'Orchestrator classifies intent and gathers missing details',
    'Grounded answer from curated knowledge, or',
    'A specialist agent acts through connectors or MCP tools',
    'Human hand-off with full context when confidence is low',
    'Every turn is logged for analytics and improvement',
  ],
  governance: ['Least-privilege connections', 'DLP policies per environment', 'Content moderation and Purview labels', 'Evaluation set run on every release'],
  phases: [
    { name: 'Discovery', weeks: '1–2', outcome: 'Use cases, data map, success measures' },
    { name: 'Pilot', weeks: '3–6', outcome: 'One agent, one channel, real users' },
    { name: 'Scale', weeks: '7–12', outcome: 'More tools and agents, ALM and telemetry' },
  ],
  risks: ['Stale or ungoverned knowledge sources', 'Over-broad connector permissions', 'No owner for ongoing tuning'],
};

export { chunks, SECTION_SCENE };
