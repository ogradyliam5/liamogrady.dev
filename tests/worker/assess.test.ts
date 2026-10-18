import { describe, expect, it } from 'vitest';
import { ASSESS_NOTE, MAX_REQUIREMENTS, assessRequirement, assessRoleFit, splitRequirements, termKey } from '../../src/worker/assess';

describe('splitRequirements', () => {
  it('turns bullets and numbered lines into requirements, dropping headings and boilerplate', () => {
    const jd = `About the role:
We are hiring!
Responsibilities
- Design Copilot Studio agents for enterprise customers
* Lead Power Platform governance and ALM;
1. Build MCP servers that connect agents to line-of-business systems.
• Build MCP servers that connect agents to line-of-business systems
Benefits: competitive salary and pension
We are an equal opportunity employer and welcome everyone.`;
    expect(splitRequirements(jd)).toEqual([
      'Design Copilot Studio agents for enterprise customers',
      'Lead Power Platform governance and ALM',
      'Build MCP servers that connect agents to line-of-business systems',
    ]);
  });

  it('splits long paragraphs into sentences and caps the count, keeping requirement-like lines', () => {
    const paragraph = Array.from({ length: 30 }, (_, i) => (i % 2 ? `Experience designing system number ${i} end to end.` : `The office has plant number ${i} in it.`)).join(' ');
    const reqs = splitRequirements(paragraph);
    expect(reqs.length).toBe(MAX_REQUIREMENTS);
    expect(reqs.every((r) => r.startsWith('Experience designing'))).toBe(true);
  });

  it('stems terms crudely but consistently', () => {
    expect(termKey('agents')).toBe(termKey('agent'));
    expect(termKey('architecture')).toBe(termKey('architect'));
    expect(termKey('management')).toBe(termKey('managed'));
  });
});

describe('assessRoleFit', () => {
  it('finds strong evidence for Liam’s core skills and none for unrelated ones', () => {
    expect(assessRequirement('Design Copilot Studio agents for enterprise customers').coverage).toBe('strong');
    expect(assessRequirement('Microsoft certifications in Power Platform').coverage).toBe('strong');
    expect(assessRequirement('Experience with SAP S/4HANA finance modules').coverage).toBe('none');
    expect(assessRequirement('Kubernetes operators written in Rust').coverage).toBe('none');
  });

  it('cites evidence for covered requirements', () => {
    const r = assessRequirement('Build MCP servers that connect agents to line-of-business systems');
    expect(r.coverage).not.toBe('none');
    expect(r.evidence.length).toBeGreaterThan(0);
    for (const e of r.evidence) {
      expect(e.id).toBeTruthy();
      expect(e.url).toMatch(/^https:\/\//);
      expect(e.snippet.length).toBeLessThanOrEqual(220);
    }
  });

  it('is deterministic and computes overall coverage from strong and partial counts', () => {
    const jd = '- Copilot Studio agent design\n- Power Platform ALM and governance\n- SAP ABAP development on HANA\n- Kubernetes operators written in Rust';
    const a = assessRoleFit(jd);
    expect(assessRoleFit(jd)).toEqual(a);
    expect(a.requirements).toHaveLength(4);
    expect(a.counts.strong + a.counts.partial + a.counts.none).toBe(4);
    expect(a.overall).toBe(Math.round((100 * (a.counts.strong + 0.5 * a.counts.partial)) / 4));
    expect(a.note).toBe(ASSESS_NOTE);
  });

  it('handles text with no requirements', () => {
    expect(assessRoleFit('hello')).toMatchObject({ overall: 0, requirements: [] });
  });

  it('stays fast enough for the Workers free plan', () => {
    const jd = Array.from({ length: 15 }, (_, i) => `- Requirement ${i}: Copilot Studio, Azure OpenAI, Dataverse and governance experience number ${i}`).join('\n');
    assessRoleFit(jd); // warm up
    const t0 = performance.now();
    assessRoleFit(jd.replace(/number/g, 'item'));
    expect(performance.now() - t0).toBeLessThan(50);
  });
});
