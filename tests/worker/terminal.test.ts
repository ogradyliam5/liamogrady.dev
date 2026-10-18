import { describe, expect, it } from 'vitest';
import { projects, publishedProjects } from '../../src/shared/knowledge';
import { MAX_WIDTH, isTerminalClient, renderTerminalCv, stripAnsi, visibleWidth, wantsColor, wrapSegments } from '../../src/worker/terminal';

describe('terminal client detection', () => {
  it.each([
    ['curl/8.9.1', '*/*'],
    ['curl/8.9', null],
    ['Wget/1.21.4', '*/*'],
    ['HTTPie/3.2.2', 'application/json, */*;q=0.5'],
    ['xh/0.22.2', '*/*'],
    ['Mozilla/5.0 (Windows NT 10.0; Microsoft Windows 10.0.26100; en-GB) PowerShell/7.5.0', null],
  ])('treats %s as a terminal', (ua, accept) => {
    expect(isTerminalClient(ua, accept)).toBe(true);
  });

  it.each([
    ['Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Safari/605.1.15', 'text/html,application/xhtml+xml'],
    ['curl/8.9.1', 'text/html'],
    ['Mozilla/5.0 PowerShell/7.5.0', 'text/html,*/*'],
    ['xhr-client/1.0', '*/*'],
    ['', '*/*'],
    [null, null],
  ])('does not treat %s (accept %s) as a terminal', (ua, accept) => {
    expect(isTerminalClient(ua, accept)).toBe(false);
  });

  it('honours ?color=0, ?plain and friends', () => {
    expect(wantsColor(new URL('https://liamogrady.dev/'))).toBe(true);
    expect(wantsColor(new URL('https://liamogrady.dev/?color=1'))).toBe(true);
    for (const q of ['?color=0', '?color=false', '?colour=no', '?plain', '?nocolor', '?no_color=1']) {
      expect(wantsColor(new URL(`https://liamogrady.dev/${q}`))).toBe(false);
    }
  });
});

describe('ANSI helpers', () => {
  it('strips SGR and OSC sequences', () => {
    expect(stripAnsi('\x1b[1;38;5;221mNOW\x1b[0m \x1b[2m──\x1b[0m')).toBe('NOW ──');
    expect(stripAnsi('\x1b]8;;https://x.y\x07link\x1b]8;;\x07')).toBe('link');
    expect(visibleWidth('\x1b[38;5;80m██\x1b[0m ab')).toBe(5);
  });

  it('wraps styled text without exceeding the width or bleeding colour', () => {
    const lines = wrapSegments(
      [{ t: 'Power Platform Solution Architect', s: '1;97' }, { t: ' · ' }, { t: 'Air Partner (a Wheels Up company) and some more words', s: '38;5;80' }],
      40,
      '  ',
      '    ',
    );
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) {
      expect(visibleWidth(l)).toBeLessThanOrEqual(40);
      expect((l.match(/\x1b\[[0-9;]*m/g) ?? []).length % 2).toBe(0); // every style opened is reset on the same line
    }
    expect(stripAnsi(lines.join(' ')).replace(/\s+/g, ' ').trim()).toBe('Power Platform Solution Architect · Air Partner (a Wheels Up company) and some more words');
  });

  it('hard-breaks words longer than the line', () => {
    const lines = wrapSegments([{ t: 'x'.repeat(95) }], 40, '  ', '  ', false);
    expect(lines.every((l) => l.length <= 40)).toBe(true);
    expect(lines.join('').replace(/\s/g, '')).toBe('x'.repeat(95));
  });
});

describe('terminal CV', () => {
  const colored = renderTerminalCv({ colo: 'LHR', elapsedMs: 0.4, color: true });
  const plain = renderTerminalCv({ colo: 'LHR', elapsedMs: 0.4, color: false });

  it('never exceeds 80 visible columns', () => {
    for (const line of colored.split('\n')) expect(visibleWidth(line)).toBeLessThanOrEqual(MAX_WIDTH);
  });

  it('uses the cyan and gold palette, and the plain variant is the same text without ANSI', () => {
    expect(colored).toContain('\x1b[38;5;80m');
    expect(colored).toContain('38;5;221m');
    expect(plain).not.toMatch(/\x1b\[/);
    expect(stripAnsi(colored)).toBe(plain);
  });

  it('has every section, the banner and the footer', () => {
    for (const s of ['NOW', 'EXPERIENCE', 'CAPABILITIES', 'PROJECTS', 'CERTIFICATIONS', 'CONTACT', "Liam O'Grady", '███████']) expect(plain).toContain(s);
    expect(plain).toContain('agents: claude mcp add --transport http liam https://liamogrady.dev/mcp');
    expect(plain).toContain('served from LHR in <1 ms');
    expect(plain).toContain('D365 CE & Power Platform Engineer'); // Air Partner progression
  });

  it('lists only published projects, with their links', () => {
    for (const p of publishedProjects) {
      expect(plain).toContain(p.name);
      expect(plain).toContain((p.live ?? p.repo)!);
    }
    for (const p of projects.filter((x) => !x.publish)) expect(plain).not.toContain(p.name);
  });

  it('follows SITE_URL in the footer and reports elapsed time', () => {
    const local = renderTerminalCv({ siteUrl: 'http://localhost:8787/', colo: 'LOCAL', elapsedMs: 12.4, color: false });
    expect(local).toContain('claude mcp add --transport http liam http://localhost:8787/mcp');
    expect(local).toContain('served from LOCAL in 12 ms');
  });
});
