import { describe, expect, it } from 'vitest';
import { assessRoleFit } from '../../src/worker/assess';
import {
  LAYER_NAMES,
  STARTING_POINT,
  architectureSummary,
  extractFirstJsonObject,
  fitCardFromAssessment,
  fitSummary,
  guessRole,
  normaliseLayerName,
  parseArchitectureCard,
  parseFitCard,
  referenceArchitecture,
  runArchitecturePipeline,
  runFitPipeline,
} from '../../src/worker/agent/pipelines';
import type { Provider } from '../../src/worker/agent/types';

const JD = `Senior AI Solution Architect
Company: Contoso
Responsibilities:
- Design Copilot Studio agents for enterprise customers
- Lead Power Platform governance and ALM
- Build MCP servers that connect agents to line-of-business systems
Requirements:
- Experience with SAP S/4HANA finance modules
- Microsoft certifications in Power Platform`;

describe('extractFirstJsonObject', () => {
  it('finds JSON inside prose and code fences', () => {
    expect(extractFirstJsonObject('Sure! Here you go:\n```json\n{"a": 1, "b": {"c": [1, 2]}}\n```\nAnything else?')).toBe('{"a": 1, "b": {"c": [1, 2]}}');
  });

  it('ignores braces inside strings and skips invalid candidates', () => {
    expect(extractFirstJsonObject('I think {this} is it: {"text": "curly } brace { and \\"quote\\""}')).toBe('{"text": "curly } brace { and \\"quote\\""}');
  });

  it('repairs trailing commas and returns null when there is no object', () => {
    expect(JSON.parse(extractFirstJsonObject('{"a": [1, 2,], "b": 3,}')!)).toEqual({ a: [1, 2], b: 3 });
    expect(extractFirstJsonObject('no json here')).toBeNull();
    expect(extractFirstJsonObject('{"unterminated": ')).toBeNull();
  });
});

describe('parseFitCard', () => {
  const sources = new Set(['role-avanade', 'cap-agents']);

  it('validates, clamps and normalises a model reply', () => {
    const reply = JSON.stringify({
      role: 'AI Architect',
      company: 'null',
      overall: '140%',
      verdict: 'Very strong.',
      strengths: ['a', 'b', 'c', 'd', 'e', 'f', 7],
      requirements: [
        { requirement: 'Copilot Studio', match: 'Strong', evidence: 'Builds agents', source: '[cap-agents]' },
        { requirement: 'Avanade', match: 'full', evidence: 'Works there', source: 'role-avanade' },
        { requirement: 'SAP', match: 'strong', evidence: 'Invented', source: 'made-up-id' },
        { requirement: 'Kubernetes', match: 'missing', evidence: '', source: '' },
        ...Array.from({ length: 10 }, (_, i) => ({ requirement: `extra ${i}`, match: 'partial', evidence: 'x', source: 'cap-agents' })),
      ],
      gaps: ['g1', 'g2', 'g3', 'g4', 'g5'],
      questions: ['q1', 'q2', 'q3', 'q4'],
    });
    const card = parseFitCard(`Here it is: ${reply}`, sources)!;
    expect(card.basis).toBe('model');
    expect(card.overall).toBe(100);
    expect(card.company).toBeNull();
    expect(card.strengths).toHaveLength(5);
    expect(card.requirements).toHaveLength(10);
    expect(card.requirements[0]).toMatchObject({ match: 'strong', source: 'cap-agents' });
    expect(card.requirements[1]).toMatchObject({ match: 'strong', source: 'role-avanade' });
    // An uncited "strong" claim is downgraded: no inflation.
    expect(card.requirements[2]).toMatchObject({ requirement: 'SAP', match: 'partial', source: '' });
    expect(card.requirements[3]).toMatchObject({ match: 'gap' });
    expect(card.gaps).toHaveLength(4);
    expect(card.questions).toHaveLength(3);
  });

  it('rejects replies without usable requirements', () => {
    expect(parseFitCard('{"role": "x", "requirements": []}', sources)).toBeNull();
    expect(parseFitCard('I cannot help with that.', sources)).toBeNull();
    expect(parseFitCard('{"requirements": "not a list"}', sources)).toBeNull();
  });

  it('strips markup and caps string lengths', () => {
    const card = parseFitCard(JSON.stringify({ role: '<b>Architect</b>', overall: -5, requirements: [{ requirement: 'r'.repeat(500), match: 'partial', evidence: 'e'.repeat(900), source: 'cap-agents' }] }), sources)!;
    expect(card.role).toBe('Architect');
    expect(card.overall).toBe(0);
    expect(card.requirements[0]!.requirement.length).toBeLessThanOrEqual(240);
    expect(card.requirements[0]!.evidence.length).toBeLessThanOrEqual(300);
  });
});

describe('deterministic fit card', () => {
  it('maps the assessment onto the fit card schema', () => {
    const card = fitCardFromAssessment(assessRoleFit(JD), JD);
    expect(card.basis).toBe('deterministic');
    expect(card.role).toBe('Senior AI Solution Architect');
    expect(card.company).toBe('Contoso');
    expect(card.overall).toBeGreaterThanOrEqual(0);
    expect(card.overall).toBeLessThanOrEqual(100);
    expect(card.requirements.length).toBeGreaterThan(0);
    expect(card.requirements.length).toBeLessThanOrEqual(10);
    expect(card.strengths.length).toBeLessThanOrEqual(5);
    expect(card.gaps.length).toBeLessThanOrEqual(4);
    expect(card.questions.length).toBeLessThanOrEqual(3);
    for (const r of card.requirements) expect(['strong', 'partial', 'gap']).toContain(r.match);
    expect(card.requirements.find((r) => /SAP/.test(r.requirement))?.match).toBe('gap');
    expect(card.requirements.find((r) => /Copilot Studio agents/.test(r.requirement))?.match).toBe('strong');
  });

  it('summarises in two or three sentences', () => {
    const s = fitSummary(fitCardFromAssessment(assessRoleFit(JD), JD));
    const sentences = s.split(/(?<=[.!?])\s+(?=[A-Z"])/);
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    expect(sentences.length).toBeLessThanOrEqual(3);
  });

  it('guesses role titles conservatively', () => {
    expect(guessRole('Job title: Lead Engineer\nmore')).toBe('Lead Engineer');
    expect(guessRole('We are a fast-growing company doing many interesting things in many places')).toBe('This role');
  });
});

describe('parseArchitectureCard', () => {
  it('normalises layer names, merges duplicates and clamps lists', () => {
    const reply = {
      title: 'Service desk agent',
      problem: 'Too many tickets',
      summary: 'A sketch.',
      layers: [
        { name: 'channels', components: [{ name: 'Teams', tech: 'Copilot Studio', purpose: 'Chat' }] },
        { name: 'Data and Knowledge', components: [{ name: 'SharePoint', tech: 'M365', purpose: 'Docs' }] },
        { name: 'Tools', components: Array.from({ length: 7 }, (_, i) => ({ name: `tool ${i}`, tech: 't', purpose: 'p' })) },
        { name: 'Agents', components: [{ name: 'Triage', tech: 'Copilot Studio', purpose: 'Route' }] },
        { name: 'Governance', components: [{ name: 'Purview', tech: 'Purview', purpose: 'DLP' }] },
        { name: 'Orchestration', components: [{ name: 'Planner', tech: 'Copilot Studio', purpose: 'Plan' }] },
        { name: 'Mystery layer', components: [{ name: 'x', tech: 'y', purpose: 'z' }] },
      ],
      flow: Array.from({ length: 12 }, (_, i) => `step ${i}`),
      governance: Array.from({ length: 9 }, (_, i) => `g ${i}`),
      phases: [
        { name: 'Pilot', weeks: '4 weeks', outcome: 'Live' },
        { name: 'Scale', weeks: 400, outcome: 'Wider' },
        { name: 'P3', weeks: 1, outcome: 'o' },
        { name: 'P4', weeks: 1, outcome: 'o' },
        { name: 'P5', weeks: 1, outcome: 'o' },
      ],
      risks: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'],
    };
    const card = parseArchitectureCard('```json\n' + JSON.stringify(reply) + '\n```', 'Too many tickets')!;
    expect(card.basis).toBe('model');
    expect(card.layers.map((l) => l.name)).toEqual([...LAYER_NAMES]);
    expect(card.layers.find((l) => l.name === 'Tools & connectors')!.components).toHaveLength(5);
    expect(card.flow).toHaveLength(8);
    expect(card.governance).toHaveLength(6);
    expect(card.phases).toHaveLength(4);
    expect(card.phases[0]!.weeks).toBe(4);
    expect(card.phases[1]!.weeks).toBe(52);
    expect(card.risks).toHaveLength(5);
  });

  it('returns null when nothing usable comes back', () => {
    expect(parseArchitectureCard('{"title": "x", "layers": [{"name": "Unknown", "components": []}]}', 'p')).toBeNull();
    expect(parseArchitectureCard('sorry', 'p')).toBeNull();
  });

  it('maps layer synonyms', () => {
    expect(normaliseLayerName('Tools and connectors')).toBe('Tools & connectors');
    expect(normaliseLayerName('Governance & Operations')).toBe('Governance & operations');
    expect(normaliseLayerName('AI agents')).toBe('Agents');
    expect(normaliseLayerName('Knowledge')).toBe('Data & knowledge');
    expect(normaliseLayerName('')).toBeNull();
  });

  it('has a well-formed reference architecture and a "starting point" reminder', () => {
    const ref = referenceArchitecture('Automate HR questions');
    expect(ref.basis).toBe('reference');
    expect(ref.problem).toBe('Automate HR questions');
    expect(ref.layers.length).toBeLessThanOrEqual(6);
    for (const l of ref.layers) {
      expect(LAYER_NAMES).toContain(l.name);
      expect(l.components.length).toBeGreaterThan(0);
      expect(l.components.length).toBeLessThanOrEqual(5);
    }
    expect(ref.flow.length).toBeLessThanOrEqual(8);
    expect(ref.governance.length).toBeLessThanOrEqual(6);
    expect(ref.phases.length).toBeLessThanOrEqual(4);
    expect(ref.risks.length).toBeLessThanOrEqual(5);
    expect(ref.note).toContain('not a design');
    expect(architectureSummary(ref).endsWith(STARTING_POINT)).toBe(true);
  });
});

describe('pipeline runners', () => {
  const failing: Provider = { name: 'x', model: 'x', chat: async () => Promise.reject(new Error('AiError: 3036: daily neurons exceeded')) };
  const garbage: Provider = { name: 'x', model: 'x', chat: async () => ({ text: 'I would rather not.', toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 } }) };

  it('falls back to the deterministic fit card when the model fails or misbehaves', async () => {
    const a = await runFitPipeline(failing, JD);
    expect(a.card.basis).toBe('deterministic');
    expect(a.error).toBeDefined();
    const b = await runFitPipeline(garbage, JD);
    expect(b.card.basis).toBe('deterministic');
    expect(b.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    const c = await runFitPipeline(null, JD);
    expect(c.calls).toBe(0);
  });

  it('falls back to the reference architecture', async () => {
    const r = await runArchitecturePipeline(failing, 'We need an HR agent in Teams');
    expect(r.card.basis).toBe('reference');
    expect(r.card.problem).toBe('We need an HR agent in Teams');
  });
});
