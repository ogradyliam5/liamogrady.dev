/**
 * The two structured pipelines behind the fit and architecture cards: prompt a model for one JSON
 * object, extract it defensively, validate and clamp it with zod, and fall back to deterministic
 * output (assess.ts / a reference architecture) whenever the model is missing or misbehaves.
 */
import { z } from 'zod';
import { search, type Hit } from '../../shared/knowledge';
import { assessRoleFit, evidenceFor, type RoleFitAssessment } from '../assess';
import { cleanLine, cleanText, truncate } from '../text';
import { architecturePrompt, fitPrompt } from './prompts';
import type { Provider, Usage } from './types';

// ---------- JSON extraction ----------

/** The first balanced, parseable {...} in a model reply (ignores prose, code fences and stray braces). */
export function extractFirstJsonObject(text: string): string | null {
  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        const candidate = text.slice(start, i + 1);
        for (const attempt of [candidate, candidate.replace(/,\s*([}\]])/g, '$1')]) {
          try {
            JSON.parse(attempt);
            return attempt;
          } catch {
            /* try the next repair or the next "{" */
          }
        }
        break;
      }
    }
  }
  return null;
}

function parseJsonObject(text: string): unknown {
  const json = extractFirstJsonObject(text);
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ---------- shared clamps ----------
// Every field is `z.unknown().optional().transform(...)`: zod 4 rejects a missing key unless the
// schema is optional, and a model that leaves a field out should get a default, not a failure.

const str = (max: number) => z.unknown().optional().transform((v) => (typeof v === 'string' ? truncate(cleanText(v), max) : typeof v === 'number' ? String(v) : ''));
const strList = (maxItems: number, maxLen: number) =>
  z.unknown().optional().transform((v) =>
    Array.isArray(v)
      ? v
          .filter((x): x is string => typeof x === 'string')
          .map((x) => truncate(cleanText(x), maxLen))
          .filter(Boolean)
          .slice(0, maxItems)
      : [],
  );

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'string' ? Number.parseFloat(v) : typeof v === 'number' ? v : Number.NaN;
  return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n))) : fallback;
}

// ---------- fit card ----------

export type FitMatch = 'strong' | 'partial' | 'gap';
export interface FitRequirement {
  requirement: string;
  match: FitMatch;
  evidence: string;
  source: string;
}
export interface FitCard {
  role: string;
  company: string | null;
  overall: number;
  verdict: string;
  strengths: string[];
  requirements: FitRequirement[];
  gaps: string[];
  questions: string[];
  /** "model" = grounded LLM analysis; "deterministic" = keyword evidence (fallback). */
  basis: 'model' | 'deterministic';
  note?: string;
}

const MATCH_WORDS: Record<string, FitMatch> = {
  strong: 'strong',
  full: 'strong',
  high: 'strong',
  yes: 'strong',
  partial: 'partial',
  medium: 'partial',
  some: 'partial',
  weak: 'partial',
  gap: 'gap',
  none: 'gap',
  missing: 'gap',
  no: 'gap',
  low: 'gap',
};

const FitRequirementSchema = z.object({
  requirement: str(240),
  match: z.unknown().optional().transform((v): FitMatch => MATCH_WORDS[String(v ?? '').trim().toLowerCase()] ?? 'gap'),
  evidence: str(300),
  source: z.unknown().optional().transform((v) => (typeof v === 'string' ? v.replace(/[[\]\s]/g, '').slice(0, 60) : '')),
});

const FitSchema = z.object({
  role: str(120),
  company: z.unknown().optional().transform((v) => (typeof v === 'string' && v.trim() && !/^(null|none|unknown|n\/a)$/i.test(v.trim()) ? truncate(cleanLine(v), 80) : null)),
  overall: z.unknown().optional().transform((v) => clampInt(v, 0, 100, 0)),
  verdict: str(300),
  strengths: strList(5, 200),
  requirements: z.unknown().optional().transform((v) =>
    Array.isArray(v)
      ? v
          .flatMap((x) => {
            const r = FitRequirementSchema.safeParse(x);
            return r.success && r.data.requirement ? [r.data] : [];
          })
          .slice(0, 10)
      : [],
  ),
  gaps: strList(4, 200),
  questions: strList(3, 200),
});

/**
 * Parses a model reply into a fit card. Requirements must cite an evidence id we actually gave the
 * model; a "strong" match without a valid source is downgraded to "partial" (no inflation).
 */
export function parseFitCard(text: string, validSources: ReadonlySet<string>): FitCard | null {
  const obj = parseJsonObject(text);
  if (!obj || typeof obj !== 'object') return null;
  const r = FitSchema.safeParse(obj);
  if (!r.success || !r.data.requirements.length) return null;
  const requirements = r.data.requirements.map((req) => {
    const known = validSources.has(req.source);
    return { ...req, source: known ? req.source : '', match: !known && req.match === 'strong' ? ('partial' as const) : req.match };
  });
  return { ...r.data, role: r.data.role || 'This role', requirements, basis: 'model' };
}

const ROLE_WORDS = /\b(architect|engineer|consultant|developer|lead|manager|specialist|director|analyst|head|principal|designer|administrator|owner|advisor)\b/i;

export function guessRole(jd: string): string {
  const labelled = jd.match(/\b(?:job title|role|position|title)\s*[:\-–]\s*([^\n]{3,90})/i);
  if (labelled?.[1]) return truncate(cleanLine(labelled[1]), 90);
  for (const line of jd.split('\n')) {
    const t = cleanLine(line);
    if (!t) continue;
    if (t.length <= 90 && ROLE_WORDS.test(t)) return t.replace(/[:.]$/, '');
    break;
  }
  return 'This role';
}

export function guessCompany(jd: string): string | null {
  const labelled = jd.match(/\b(?:company|organisation|organization|employer)\s*[:\-–]\s*([^\n]{2,60})/i);
  return labelled?.[1] ? truncate(cleanLine(labelled[1]), 60) : null;
}

function verdictFor(overall: number, count: number): string {
  if (!count) return 'No clear requirements found in the text, so there is nothing to match yet.';
  if (overall >= 75) return "Strong overlap with Liam's public profile.";
  if (overall >= 50) return 'Good overlap, with a few areas worth exploring in conversation.';
  if (overall >= 25) return "Partial overlap: several requirements aren't evidenced in the public profile.";
  return "Little public evidence for this role's requirements.";
}

/** Maps the deterministic assessment onto the fit card schema (fallback path). */
export function fitCardFromAssessment(a: RoleFitAssessment, jd: string): FitCard {
  const gaps = a.requirements.filter((r) => r.coverage === 'none');
  const questions = ['Which of these requirements are must-haves for the first six months?'];
  if (gaps[0]) questions.push(`Can Liam share examples relevant to "${truncate(gaps[0].requirement, 80)}"? The full CV has client-level detail.`);
  questions.push("What does the team's current Microsoft AI stack look like?");
  return {
    role: guessRole(jd),
    company: guessCompany(jd),
    overall: a.overall,
    verdict: verdictFor(a.overall, a.requirements.length),
    strengths: a.requirements
      .filter((r) => r.coverage === 'strong')
      .slice(0, 5)
      .map((r) => truncate(r.requirement, 200)),
    requirements: a.requirements.slice(0, 10).map((r) => ({
      requirement: truncate(r.requirement, 240),
      match: r.coverage === 'none' ? ('gap' as const) : r.coverage,
      evidence: r.evidence[0]?.snippet ?? 'No matching evidence in the public profile.',
      source: r.evidence[0]?.id ?? '',
    })),
    gaps: gaps.slice(0, 4).map((r) => truncate(r.requirement, 200)),
    questions: questions.slice(0, 3),
    basis: 'deterministic',
    note: 'Keyword evidence from the public profile (the live model was not used). Client-level detail is in the full CV, on request.',
  };
}

export function fitSummary(card: FitCard): string {
  const count = (m: FitMatch) => card.requirements.filter((r) => r.match === m).length;
  const where = card.company ? ` at ${card.company}` : '';
  const first = card.verdict || "Here is how Liam's public profile lines up.";
  const role = card.role === 'This role' ? 'this role' : card.role;
  const second = `Overall fit for ${role}${where}: ${card.overall}/100, with ${count('strong')} strong, ${count('partial')} partial and ${count('gap')} gap${count('gap') === 1 ? '' : 's'} across the requirements I could find.`;
  const third = card.gaps[0]
    ? `The clearest gap in the public evidence is "${truncate(card.gaps[0], 90)}", worth raising with Liam directly.`
    : 'For client-level examples, request the full CV through the contact form.';
  return `${first} ${second} ${third}`;
}

// ---------- architecture card ----------

export const LAYER_NAMES = ['Channels', 'Orchestration', 'Agents', 'Tools & connectors', 'Data & knowledge', 'Governance & operations'] as const;
export type LayerName = (typeof LAYER_NAMES)[number];
export interface ArchComponent {
  name: string;
  tech: string;
  purpose: string;
}
export interface ArchLayer {
  name: LayerName;
  components: ArchComponent[];
}
export interface ArchPhase {
  name: string;
  weeks: number;
  outcome: string;
}
export interface ArchitectureCard {
  title: string;
  problem: string;
  summary: string;
  layers: ArchLayer[];
  flow: string[];
  governance: string[];
  phases: ArchPhase[];
  risks: string[];
  /** "model" = sketched for this problem; "reference" = the generic fallback. */
  basis: 'model' | 'reference';
  note?: string;
}

export function normaliseLayerName(v: unknown): LayerName | null {
  const s = String(v ?? '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;
  if (/^channel/.test(s) || /\b(ui|front ?end|surface|experience)s?\b/.test(s)) return 'Channels';
  if (/orchestrat|routing|planner/.test(s)) return 'Orchestration';
  if (/^agents?\b|\bagents?$/.test(s) && !/tool|data/.test(s)) return 'Agents';
  if (/tool|connector|integration|action|api/.test(s)) return 'Tools & connectors';
  if (/data|knowledge|retrieval|search|storage/.test(s)) return 'Data & knowledge';
  if (/govern|operation|security|ops|monitor|compliance/.test(s)) return 'Governance & operations';
  return null;
}

const ComponentSchema = z.object({ name: str(80), tech: str(120), purpose: str(200) });
const PhaseSchema = z.object({ name: str(80), weeks: z.unknown().optional().transform((v) => clampInt(v, 1, 52, 2)), outcome: str(200) });

const ArchitectureSchema = z.object({
  title: str(120),
  problem: str(300),
  summary: str(600),
  layers: z.unknown().optional().transform((v) => {
    if (!Array.isArray(v)) return [] as ArchLayer[];
    const byName = new Map<LayerName, ArchComponent[]>();
    for (const layer of v) {
      if (!layer || typeof layer !== 'object') continue;
      const name = normaliseLayerName((layer as { name?: unknown }).name);
      if (!name) continue;
      const comps = (layer as { components?: unknown }).components;
      const list = Array.isArray(comps)
        ? comps.flatMap((c) => {
            const r = ComponentSchema.safeParse(c);
            return r.success && r.data.name ? [r.data] : [];
          })
        : [];
      byName.set(name, [...(byName.get(name) ?? []), ...list].slice(0, 5));
    }
    return LAYER_NAMES.filter((n) => byName.get(n)?.length).map((n) => ({ name: n, components: byName.get(n) ?? [] }));
  }),
  flow: strList(8, 200),
  governance: strList(6, 200),
  phases: z.unknown().optional().transform((v) =>
    Array.isArray(v)
      ? v
          .flatMap((p) => {
            const r = PhaseSchema.safeParse(p);
            return r.success && r.data.name ? [r.data] : [];
          })
          .slice(0, 4)
      : [],
  ),
  risks: strList(5, 200),
});

export function parseArchitectureCard(text: string, problem: string): ArchitectureCard | null {
  const obj = parseJsonObject(text);
  if (!obj || typeof obj !== 'object') return null;
  const r = ArchitectureSchema.safeParse(obj);
  if (!r.success || !r.data.layers.length) return null;
  return {
    ...r.data,
    title: r.data.title || 'Solution sketch',
    problem: r.data.problem || truncate(cleanLine(problem), 300),
    basis: 'model',
  };
}

export const STARTING_POINT = 'This is a starting point for a discovery conversation, not a design.';

/** The fixed fallback: a well-trodden enterprise Copilot Studio agent architecture. */
export function referenceArchitecture(problem = ''): ArchitectureCard {
  return {
    title: 'Reference architecture: an enterprise Copilot Studio agent',
    problem: problem ? truncate(cleanLine(problem), 300) : 'A governed AI agent for employees on the Microsoft stack.',
    summary:
      'A Copilot Studio agent in Teams and Microsoft 365 Copilot, grounded in permission-trimmed SharePoint and Dataverse knowledge, acting on line-of-business systems through Power Platform connectors and MCP tools, with Microsoft Foundry for specialist models. Entra ID, Purview and Managed Environments keep it governed from pilot to scale.',
    layers: [
      {
        name: 'Channels',
        components: [
          { name: 'Teams and Microsoft 365 Copilot', tech: 'Copilot Studio channels', purpose: 'Meet people where they already work, with Entra ID single sign-on.' },
          { name: 'Web chat', tech: 'Copilot Studio web channel', purpose: 'Optional customer- or partner-facing surface on an existing site.' },
        ],
      },
      {
        name: 'Orchestration',
        components: [
          { name: 'Generative orchestration', tech: 'Copilot Studio', purpose: 'Plans across topics, tools, knowledge and child agents from clear instructions.' },
          { name: 'Human hand-off', tech: 'Copilot Studio with Teams or Dynamics 365 Contact Center', purpose: 'Escalates with full context when confidence or policy requires it.' },
        ],
      },
      {
        name: 'Agents',
        components: [
          { name: 'Front-door agent', tech: 'Copilot Studio', purpose: 'Owns the conversation, routing and tone of voice.' },
          { name: 'Specialist agents', tech: 'Copilot Studio child agents or Microsoft Foundry Agent Service', purpose: 'Focused skills that can be tested and released independently.' },
        ],
      },
      {
        name: 'Tools & connectors',
        components: [
          { name: 'Line-of-business actions', tech: 'Power Platform connectors and Power Automate', purpose: 'Create and update records in ITSM, CRM or ERP, with approvals for writes.' },
          { name: 'Shared tools', tech: 'MCP servers on Azure Functions or Container Apps', purpose: 'Reusable, secured tool surfaces shared across agents.' },
          { name: 'Work context', tech: 'Microsoft Graph', purpose: 'Calendar, people and document context for the signed-in user.' },
        ],
      },
      {
        name: 'Data & knowledge',
        components: [
          { name: 'Enterprise knowledge', tech: 'SharePoint and Microsoft 365 knowledge sources', purpose: 'Permission-trimmed grounding in policies and procedures.' },
          { name: 'Structured data', tech: 'Dataverse', purpose: 'Cases, outcomes and reference data with row-level security.' },
          { name: 'Large-corpus retrieval', tech: 'Azure AI Search', purpose: 'Hybrid search when content outgrows built-in knowledge.' },
        ],
      },
      {
        name: 'Governance & operations',
        components: [
          { name: 'Identity and access', tech: 'Entra ID', purpose: 'Single sign-on, least-privilege connections and conditional access.' },
          { name: 'Data protection', tech: 'Microsoft Purview and DLP policies', purpose: 'Sensitivity labels, data loss prevention and audit.' },
          { name: 'Lifecycle', tech: 'Managed Environments and Power Platform pipelines', purpose: 'Dev, test and production with approvals, checks and rollback.' },
          { name: 'Observability', tech: 'Copilot Studio analytics and Application Insights', purpose: 'Resolution, escalation, cost and quality over time.' },
        ],
      },
    ],
    flow: [
      'A user asks in Teams or Microsoft 365 Copilot; Entra ID signs them in.',
      'Copilot Studio orchestration chooses knowledge, a tool or a specialist agent from its instructions.',
      'Answers are grounded in permission-trimmed SharePoint and Dataverse content, with citations.',
      'Actions run through connectors, Power Automate or MCP tools, with approval steps for anything that writes.',
      'Low-confidence or sensitive requests hand off to a person with the full transcript.',
      'Outcomes and feedback land in Dataverse and analytics to drive the next iteration.',
    ],
    governance: [
      'Responsible AI review and a written scope before build starts.',
      'DLP policies separating business and non-business connectors.',
      'Managed Environments with solution-aware ALM and release approvals.',
      'Knowledge sources that respect Purview sensitivity labels and permissions.',
      'Usage, cost and quality reviewed every sprint against agreed measures.',
    ],
    phases: [
      { name: 'Discovery and guardrails', weeks: 2, outcome: 'Use cases ranked by value and risk; environments, DLP and ALM in place.' },
      { name: 'Pilot agent', weeks: 4, outcome: 'One high-value journey live for a pilot group, with measurement.' },
      { name: 'Scale tools and knowledge', weeks: 6, outcome: 'Hardened connectors, MCP tools and knowledge; hand-off and analytics live.' },
      { name: 'Roll out and operate', weeks: 4, outcome: 'Wider release, a support model and a backlog driven by real conversations.' },
    ],
    risks: [
      'Knowledge quality: outdated or conflicting documents produce confident wrong answers.',
      'Over-broad permissions on connectors or knowledge sources.',
      'Copilot Studio capacity and licensing not forecast early enough.',
      'Adoption: an agent that launches but is not woven into daily work.',
      'Unclear ownership of content, tools and the agent after go-live.',
    ],
    basis: 'reference',
    note: `Generic reference architecture (the live model was not used), not a design for your specific problem. ${STARTING_POINT}`,
  };
}

export function architectureSummary(card: ArchitectureCard): string {
  const lead = card.summary || `A first sketch for: ${card.problem}`;
  return `${lead}\n\n${STARTING_POINT}`;
}

// ---------- pipeline runners ----------

export interface PipelineRun<T> {
  card: T;
  usage: Usage;
  /** Model calls made (0 when no provider). */
  calls: number;
  evidence: Hit[];
  /** Why the deterministic output was used, when a model was available but failed. */
  error?: unknown;
}

const ZERO: Usage = { inputTokens: 0, outputTokens: 0 };

export async function runFitPipeline(provider: Provider | null, jobDescription: string): Promise<PipelineRun<FitCard>> {
  const evidence = evidenceFor(jobDescription, 8);
  const deterministic = () => fitCardFromAssessment(assessRoleFit(jobDescription), jobDescription);
  if (!provider) return { card: deterministic(), usage: { ...ZERO }, calls: 0, evidence };
  try {
    const { system, user } = fitPrompt(jobDescription, evidence);
    const res = await provider.chat({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], json: true, maxTokens: 2048 });
    const card = parseFitCard(res.text, new Set(evidence.map((e) => e.id)));
    if (card) return { card, usage: res.usage, calls: 1, evidence };
    return { card: deterministic(), usage: res.usage, calls: 1, evidence, error: new Error('unparseable fit JSON') };
  } catch (error) {
    return { card: deterministic(), usage: { ...ZERO }, calls: 1, evidence, error };
  }
}

export async function runArchitecturePipeline(provider: Provider | null, problem: string): Promise<PipelineRun<ArchitectureCard>> {
  const evidence = search(problem, 4);
  if (!provider) return { card: referenceArchitecture(problem), usage: { ...ZERO }, calls: 0, evidence };
  try {
    const { system, user } = architecturePrompt(problem, evidence);
    const res = await provider.chat({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], json: true, maxTokens: 2048 });
    const card = parseArchitectureCard(res.text, problem);
    if (card) return { card, usage: res.usage, calls: 1, evidence };
    return { card: referenceArchitecture(problem), usage: res.usage, calls: 1, evidence, error: new Error('unparseable architecture JSON') };
  } catch (error) {
    return { card: referenceArchitecture(problem), usage: { ...ZERO }, calls: 1, evidence, error };
  }
}
