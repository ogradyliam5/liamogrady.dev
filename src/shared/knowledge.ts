/**
 * The public knowledge base about Liam, derived from content/profile.ts.
 * Used by: llms.txt, the MCP server, the on-site agent (grounding + search tool)
 * and the terminal CV. Everything here is public-safe by construction.
 */
import {
  person,
  experience,
  education,
  certifications,
  capabilities,
  skills,
  projects,
  writing,
  music,
  now,
  yearsOfExperience,
  type Role,
} from '../../content/profile';

export const SITE = 'https://liamogrady.dev';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtMonth(iso: string | null): string {
  if (!iso) return 'Present';
  const [y, m] = iso.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

export function roleSpan(r: Pick<Role, 'start' | 'end'>): string {
  return `${fmtMonth(r.start)} – ${fmtMonth(r.end)}`;
}

export const publishedProjects = projects.filter((p) => p.publish);

export type Chunk = { id: string; section: string; title: string; text: string; url: string; keywords?: string };

/** Small, citeable chunks. Section ids match the page anchors so the agent can navigate. */
export function chunks(): Chunk[] {
  const out: Chunk[] = [];
  out.push({
    id: 'about',
    section: 'about',
    title: `About ${person.name}`,
    text: `${person.oneLiner} ${person.summary.join(' ')} Based in ${person.location}, originally from ${person.origin}. ${yearsOfExperience()} years of experience since ${fmtMonth(person.careerStart.slice(0, 7))}.`,
    url: `${SITE}/#about`,
  });
  for (const r of experience) {
    const steps = r.steps ? ` Progression: ${r.steps.map((s) => `${s.title} (${fmtMonth(s.start)} – ${fmtMonth(s.end)})`).join('; ')}.` : '';
    out.push({
      id: `role-${r.id}`,
      section: 'journey',
      title: `${r.title}, ${r.company}${r.parent ? ` (${r.parent})` : ''}`,
      text: `${r.title} at ${r.company}, ${r.place}, ${roleSpan(r)}. ${r.summary}${steps} ${r.highlights.join(' ')} Stack: ${r.stack.join(', ')}.`,
      url: `${SITE}/#journey`,
      keywords: `job role employer work experience career ${r.id === 'air-partner' ? 'aviation airline private jet charter flights' : ''}${r.end === null ? ' current currently now today' : ''}`,
    });
  }
  out.push({
    id: 'education',
    section: 'journey',
    title: education.qualification,
    text: `${education.qualification}, ${education.institution}, ${education.start}–${education.end}. ${education.project}`,
    url: `${SITE}/#journey`,
    keywords: 'study studied university college degree education school qualification graduate',
  });
  for (const c of capabilities) {
    out.push({
      id: `cap-${c.id}`,
      section: 'capabilities',
      title: c.title,
      text: `${c.title}: ${c.blurb} ${c.points.join('. ')}. Tools: ${c.tools.join(', ')}.`,
      url: `${SITE}/#capabilities`,
    });
  }
  out.push({
    id: 'certifications',
    section: 'credentials',
    title: 'Microsoft certifications',
    text: `Microsoft certifications: ${certifications.map((c) => `${c.name} (${c.level})`).join('; ')}. Each can be verified on Microsoft Learn.`,
    url: `${SITE}/#credentials`,
    keywords: 'certified certification certificates credentials exams qualified microsoft learn badge',
  });
  out.push({
    id: 'skills',
    section: 'capabilities',
    title: 'Skills',
    text: skills.map((g) => `${g.group}: ${g.items.join(', ')}`).join('. ') + '.',
    url: `${SITE}/#capabilities`,
  });
  for (const p of publishedProjects) {
    out.push({
      id: `project-${p.id}`,
      section: 'work',
      title: p.name,
      text: `${p.name} (${p.year}, ${p.kind}): ${p.tagline} ${p.description} Stack: ${p.stack.join(', ')}.${p.repo ? ` Source: ${p.repo}.` : ''}${p.live ? ` Live: ${p.live}.` : ''}`,
      url: p.live ?? p.repo ?? `${SITE}/#work`,
      keywords: 'project projects built build side open source github tool portfolio',
    });
  }
  for (const w of writing) {
    out.push({ id: `post-${w.date}`, section: 'writing', title: w.title, text: `Article (${w.date}): ${w.title}. ${w.summary}`, url: w.href });
  }
  out.push({
    id: 'music',
    section: 'about',
    title: music.band,
    text: `Outside work, ${person.givenName} plays ${music.role} with ${music.band}, ${music.blurb}`,
    url: music.bandUrl,
    keywords: 'band music musician folk trad irish banjo gigs hobby hobbies outside work interests',
  });
  out.push({ id: 'now', section: 'about', title: `Now (${now.updated})`, text: now.items.join(' '), url: `${SITE}/#about` });
  out.push({
    id: 'site-mcp',
    section: 'agents',
    title: 'Connect this site to your own agent (MCP)',
    text: `This site runs a public, read-only MCP server at ${SITE}/mcp (Streamable HTTP, no authentication, rate-limited) with seven tools: get_profile, get_experience, list_projects, get_certifications, search_profile, assess_role_fit and get_contact_options. In Copilot Studio: Tools, Add a tool, Model Context Protocol, paste the URL and choose authentication None. In Claude Code: claude mcp add --transport http liam ${SITE}/mcp. VS Code and Cursor have one-click install links in the For agents section, and ${SITE}/agents has the details for developers.`,
    url: `${SITE}/#agents`,
    keywords: 'mcp model context protocol connect plug add install copilot studio claude code vs code cursor chatgpt server url tools integrate',
  });
  out.push({
    id: 'contact',
    section: 'contact',
    title: 'Contact',
    text: `Email ${person.email}. LinkedIn ${person.links.linkedin}. GitHub ${person.links.github}. For client and project specifics, request the full CV through the form at ${SITE}/#contact.`,
    url: `${SITE}/#contact`,
    keywords: 'contact email hire hiring reach cv resume available availability linkedin',
  });
  return out;
}

// ---------- Tiny BM25 search (no dependencies) ----------

const STOP = new Set(
  'a an and are as at be by for from has have he his i in is it its of on or that the this to was were will with what who how does do did can liam liams o grady ogrady about me my you your'.split(' '),
);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s+#.]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[.]+|[.]+$/g, ''))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export type Hit = Chunk & { score: number };

export function search(query: string, limit = 5, corpus: Chunk[] = chunks()): Hit[] {
  const q = tokenize(query);
  if (!q.length) return [];
  const docs = corpus.map((c) => tokenize(`${c.title} ${c.title} ${c.text} ${c.keywords ?? ''}`));
  const avg = docs.reduce((s, d) => s + d.length, 0) / docs.length;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const N = docs.length;
  const k1 = 1.4;
  const b = 0.72;
  const hits: Hit[] = corpus.map((c, i) => {
    const d = docs[i]!;
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const t of q) {
      // prefix match lets "agent" find "agents", "architect" find "architecture"
      let f = tf.get(t) ?? 0;
      if (!f) for (const [term, n] of tf) if (term.startsWith(t) || t.startsWith(term)) f += n * 0.6;
      if (!f) continue;
      const n = df.get(t) ?? 1;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avg));
    }
    return { ...c, score };
  });
  return hits
    .filter((h) => h.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, limit);
}

// ---------- Markdown renderings ----------

export function profileMarkdown(): string {
  const L: string[] = [];
  L.push(`# ${person.name}`);
  L.push('');
  L.push(`> ${person.oneLiner}`);
  L.push('');
  L.push(...person.summary);
  L.push('');
  L.push(`- Location: ${person.location} (from ${person.origin})`);
  L.push(`- Experience: ${yearsOfExperience()} years (since ${fmtMonth(person.careerStart.slice(0, 7))})`);
  L.push(`- Email: ${person.email}`);
  L.push(`- LinkedIn: ${person.links.linkedin}`);
  L.push(`- GitHub: ${person.links.github}`);
  L.push('');
  L.push('## Experience');
  for (const r of experience) {
    L.push('');
    L.push(`### ${r.title} · ${r.company}${r.parent ? ` (${r.parent})` : ''}`);
    L.push(`${roleSpan(r)} · ${r.place}`);
    L.push('');
    L.push(r.summary);
    if (r.steps) L.push('', ...r.steps.map((s) => `- ${s.title}: ${fmtMonth(s.start)} – ${fmtMonth(s.end)}`));
    L.push('', ...r.highlights.map((h) => `- ${h}`));
  }
  L.push('');
  L.push('## Education');
  L.push(`- ${education.qualification}, ${education.institution} (${education.start}–${education.end}). ${education.project}`);
  L.push('');
  L.push('## Capabilities');
  for (const c of capabilities) {
    L.push('');
    L.push(`### ${c.title}`);
    L.push(c.blurb);
    L.push(...c.points.map((p) => `- ${p}`));
  }
  L.push('');
  L.push('## Certifications');
  L.push(...certifications.map((c) => `- [${c.name}](${c.verifyUrl})`));
  L.push('');
  L.push('## Skills');
  L.push(...skills.map((g) => `- ${g.group}: ${g.items.join(', ')}`));
  L.push('');
  L.push('## Projects');
  for (const p of publishedProjects) {
    L.push(`- **${p.name}** (${p.year}): ${p.tagline} ${p.description}${p.repo ? ` Source: ${p.repo}` : ''}${p.live ? ` · Live: ${p.live}` : ''}`);
  }
  L.push('');
  L.push('## Writing');
  L.push(...writing.map((w) => `- [${w.title}](${w.href}) (${w.date}): ${w.summary}`));
  L.push('');
  L.push('## Outside work');
  L.push(`- ${person.givenName} plays ${music.role} with [${music.band}](${music.bandUrl}), ${music.blurb}`);
  L.push('');
  L.push(`## Now (${now.updated})`);
  L.push(...now.items.map((n) => `- ${n}`));
  L.push('');
  L.push('---');
  L.push('Client names, project specifics and metrics are deliberately not public. Ask for the full CV via ' + SITE + '/#contact.');
  return L.join('\n');
}

export {
  person,
  experience,
  education,
  certifications,
  capabilities,
  skills,
  projects,
  writing,
  music,
  now,
  yearsOfExperience,
};
