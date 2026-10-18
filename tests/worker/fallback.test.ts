import { describe, expect, it } from 'vitest';
import { fallbackAnswer, highlightForChunk, uiForChunk } from '../../src/worker/agent/fallback';
import { HIGHLIGHT_TARGETS, NAV_SECTIONS } from '../../src/worker/agent/tools';

describe('fallback answers', () => {
  it('composes an intro line plus up to three cited bullets', () => {
    const a = fallbackAnswer('What MCP servers has Liam built?');
    const lines = a.text.split('\n').filter(Boolean);
    expect(lines[0]).toMatch(/Liam's public profile/);
    const bullets = lines.slice(1);
    expect(bullets.length).toBeGreaterThan(0);
    expect(bullets.length).toBeLessThanOrEqual(3);
    for (const b of bullets) expect(b).toMatch(/^- \[[^\]]+\]\(https:\/\/[^)]+\): .+/);
    expect(a.hits.length).toBe(bullets.length);
  });

  it('emits navigate and highlight UI hints for the top hit', () => {
    const a = fallbackAnswer('Claw PC for Copilot Cowork');
    expect(a.hits[0]?.id).toBe('project-claw-pc');
    expect(a.ui).toEqual([
      { action: 'navigate', args: { section: 'work' } },
      { action: 'highlight', args: { target: 'project:claw-pc' } },
    ]);
  });

  it('suggests the CV form when nothing matches', () => {
    const a = fallbackAnswer('zzzz qqqq');
    expect(a.hits).toEqual([]);
    expect(a.ui).toEqual([]);
    expect(a.text).toContain('https://liamogrady.dev/#contact');
  });

  it('accepts a custom intro', () => {
    expect(fallbackAnswer('certifications', 'Custom intro.').text.startsWith('Custom intro.\n\n- [')).toBe(true);
  });

  it('maps chunk ids to page targets', () => {
    expect(highlightForChunk('role-air-partner')).toBe('role:air-partner');
    expect(highlightForChunk('cap-mcp')).toBe('cap:mcp');
    expect(highlightForChunk('project-drift-review')).toBeNull(); // unpublished
    expect(highlightForChunk('certifications')).toBe('cert:agentic-architect');
    expect(highlightForChunk('music')).toBeNull();
    expect(uiForChunk({ id: 'music', section: 'about' })).toEqual([{ action: 'navigate', args: { section: 'about' } }]);
    for (const t of HIGHLIGHT_TARGETS) expect(t).toMatch(/^(project|cert|role|cap):[a-z0-9-]+$/);
    expect(NAV_SECTIONS).toContain('agents');
  });
});
