/**
 * Deterministic role-fit assessment (no LLM, so it costs nothing): split a job description into
 * requirement lines, rank evidence for each with the shared BM25 search(), then grade coverage by
 * how much of the requirement's vocabulary the best two passages contain, weighting rare terms
 * (IDF over the profile) above common ones, so "SAP S/4HANA finance" is not a match just
 * because the profile mentions finance once.
 * Used by the MCP tool assess_role_fit and as the on-site agent's fallback for fit mode.
 */
import { chunks, search, tokenize, type Chunk, type Hit } from '../shared/knowledge';
import { truncate } from './text';

export type Coverage = 'strong' | 'partial' | 'none';
export interface Evidence {
  id: string;
  title: string;
  url: string;
  snippet: string;
}
export interface RequirementAssessment {
  requirement: string;
  coverage: Coverage;
  evidence: Evidence[];
}
export interface RoleFitAssessment {
  overall: number;
  counts: Record<Coverage, number>;
  requirements: RequirementAssessment[];
  note: string;
}

export const MAX_REQUIREMENTS = 15;
export const MAX_JD_CHARS = 8000;

export const ASSESS_NOTE =
  "Deterministic keyword evidence from Liam O'Grady's public profile, not a judgement. Reason over the evidence yourself: " +
  "'none' can mean the profile phrases it differently, so check before calling it a gap, and never invent experience. " +
  'Client names, projects and metrics are deliberately excluded; suggest requesting the full CV at https://liamogrady.dev/#contact for detail.';

// Words that carry no signal in job descriptions (on top of the shared stop-words).
const JD_NOISE = new Set(
  (
    'experience experienced strong proven ability able skill skills knowledge understanding excellent good great solid ' +
    'working work deep track record years year plus desirable essential required requirement requirements preferred must ' +
    'should would including include etc role responsible responsibilities using use across within ensure demonstrate ' +
    'demonstrated demonstrable familiarity familiar hands relevant related similar environment environments level high ' +
    'highly candidate ideal we our us their they them other others new also well least minimum like looking join'
  ).split(' '),
);

const HEADING_ONLY =
  /^(about (the )?(role|you|us|company)|(key )?responsibilities|requirements|qualifications|what you('| wi)ll do|what we('re| are) looking for|who you are|nice to have|benefits|the role|skills( and experience)?|essential|desirable)\b.{0,30}$/i;
const BOILERPLATE =
  /\b(equal opportunit|benefits package|salary|pension|holiday|annual leave|apply now|how to apply|we offer|diversity|inclusive employer|visa|sponsorship|competitive|bonus|recruitment agenc|privacy notice|cookie)/i;
const CUES = /\b(experience|knowledge|skills?|ability|familiar|proficien|certif|expert|background|understanding|design|architect|build|deliver|lead|implement|develop|manage|govern|integrat|stakeholder|degree)/gi;

/** Crude stem so "agents"/"agent", "architecture"/"architect" and "managed"/"management" line up. */
export function termKey(t: string): string {
  return t.length > 6 ? t.slice(0, 6) : t.replace(/s$/, '');
}

interface ProfileIndex {
  day: string;
  docs: Chunk[];
  keys: Map<string, Set<string>>;
  idf: Map<string, number>;
}
let cached: ProfileIndex | null = null;

/** The shared chunks plus per-chunk term keys, built once per isolate per day (chunks() reads today's date). */
function profileIndex(): ProfileIndex {
  const day = new Date().toISOString().slice(0, 10);
  if (!cached || cached.day !== day) {
    const docs = chunks();
    const keys = new Map(docs.map((c) => [c.id, new Set(tokenize(`${c.title} ${c.text} ${c.keywords ?? ''}`).map(termKey))]));
    cached = { day, docs, keys, idf: new Map() };
  }
  return cached;
}

export function corpus(): Chunk[] {
  return profileIndex().docs;
}

function idf(key: string, index: ProfileIndex): number {
  let v = index.idf.get(key);
  if (v === undefined) {
    let n = 0;
    for (const set of index.keys.values()) if (set.has(key)) n++;
    const N = index.docs.length;
    v = Math.log(1 + (N - n + 0.5) / (n + 0.5));
    index.idf.set(key, v);
  }
  return v;
}

function cleanRequirement(line: string): string {
  return line
    .replace(/^\s*(?:[-*•·●▪◦‣–—>]+|\(?\d{1,2}[.)]|\(?[a-z][.)])\s+/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[;:,.]+$/, '')
    .trim();
}

/** Requirement-like lines/bullets from a job description, most useful first when trimming. */
export function splitRequirements(jd: string, max = MAX_REQUIREMENTS): string[] {
  const text = jd.replace(/\r\n?/g, '\n').slice(0, MAX_JD_CHARS);
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const t = truncate(cleanRequirement(raw), 280);
    if (t.length < 12 || t.split(' ').length < 3) return;
    if (HEADING_ONLY.test(t) || BOILERPLATE.test(t) || requirementKeys(t).length < 2) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    found.push(t);
  };
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.endsWith(':') && line.length < 80) continue;
    if (line.length > 200) for (const s of line.split(/(?<=[.!?;])\s+/)) push(s);
    else push(line);
  }
  if (found.length <= max) return found;
  return found
    .map((t, i) => ({ t, i, score: (t.match(CUES) ?? []).length }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.t);
}

/** Distinct term keys that carry meaning in a requirement (no stop-words, JD filler or bare numbers). */
function requirementKeys(s: string): string[] {
  return [...new Set(tokenize(s).filter((t) => !JD_NOISE.has(t) && !/^\d+\+?$/.test(t)).map(termKey))];
}

function bestSnippet(hit: Chunk, keys: string[]): string {
  const sentences = hit.text.split(/(?<=[.!?])\s+/);
  let best = sentences[0] ?? hit.text;
  let bestScore = -1;
  for (const s of sentences) {
    const sk = new Set(tokenize(s).map(termKey));
    const score = keys.filter((k) => sk.has(k)).length;
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return truncate(best.trim(), 220);
}

export function assessRequirement(requirement: string): RequirementAssessment & { hits: Hit[] } {
  const index = profileIndex();
  const keys = requirementKeys(requirement);
  const hits = keys.length ? search(requirement, 3, index.docs) : [];
  if (!hits.length) return { requirement, coverage: 'none', evidence: [], hits };
  const top = hits.slice(0, 2);
  const covered = (k: string) => top.some((h) => index.keys.get(h.id)?.has(k));
  let total = 0;
  let got = 0;
  let matched = 0;
  for (const k of keys) {
    const w = idf(k, index);
    total += w;
    if (covered(k)) {
      got += w;
      matched++;
    }
  }
  const ratio = total ? got / total : 0;
  let coverage: Coverage = 'none';
  if (ratio >= 0.6 && (matched >= 2 || keys.length === 1)) coverage = 'strong';
  else if (ratio >= 0.3 && matched >= 1) coverage = 'partial';
  const evidence = coverage === 'none' ? [] : top.map((h) => ({ id: h.id, title: h.title, url: h.url, snippet: bestSnippet(h, keys) }));
  return { requirement, coverage, evidence, hits };
}

export function assessRoleFit(jobDescription: string): RoleFitAssessment {
  const requirements = splitRequirements(jobDescription).map((r) => {
    const { hits: _hits, ...rest } = assessRequirement(r);
    return rest;
  });
  const counts: Record<Coverage, number> = { strong: 0, partial: 0, none: 0 };
  for (const r of requirements) counts[r.coverage]++;
  const overall = requirements.length ? Math.round((100 * (counts.strong + 0.5 * counts.partial)) / requirements.length) : 0;
  return { overall, counts, requirements, note: ASSESS_NOTE };
}

/** Evidence chunks for a longer text (job description, problem): best hits across its requirement lines. */
export function evidenceFor(text: string, limit = 8): Hit[] {
  const docs = corpus();
  const best = new Map<string, Hit>();
  const lines = splitRequirements(text, 12);
  for (const q of lines.length ? lines : [text.slice(0, 600)]) {
    for (const h of search(q, 2, docs)) {
      const prev = best.get(h.id);
      if (!prev || prev.score < h.score) best.set(h.id, h);
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
