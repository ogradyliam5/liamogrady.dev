/**
 * Per-section views of the public profile (markdown + structured), shared by the MCP server
 * (get_profile and friends) and the on-site agent (get_section). Data comes from
 * content/profile.ts via src/shared/knowledge.ts; nothing here adds facts.
 */
import {
  SITE,
  capabilities,
  certifications,
  education,
  experience,
  fmtMonth,
  music,
  now,
  person,
  publishedProjects,
  roleSpan,
  skills,
  writing,
  yearsOfExperience,
} from '../shared/knowledge';

export const PROFILE_SECTIONS = [
  'summary',
  'experience',
  'capabilities',
  'certifications',
  'projects',
  'skills',
  'writing',
  'music',
  'contact',
] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

export const CV_REQUEST_URL = `${SITE}/#contact`;
export const PRIVACY_NOTE =
  'Client names, client projects and metrics are deliberately not public. Request the full CV at ' + CV_REQUEST_URL + '.';

/** Chunk ids (src/shared/knowledge.ts) that back each section, for citations. */
export function sectionChunkIds(section: ProfileSection): string[] {
  switch (section) {
    case 'summary':
      return ['about', 'now'];
    case 'experience':
      return [...experience.map((r) => `role-${r.id}`), 'education'];
    case 'capabilities':
      return capabilities.map((c) => `cap-${c.id}`);
    case 'certifications':
      return ['certifications'];
    case 'projects':
      return publishedProjects.map((p) => `project-${p.id}`);
    case 'skills':
      return ['skills'];
    case 'writing':
      return writing.map((w) => `post-${w.date}`);
    case 'music':
      return ['music'];
    case 'contact':
      return ['contact'];
  }
}

export function contactOptions() {
  return {
    email: person.email,
    linkedin: person.links.linkedin,
    github: person.links.github,
    cvRequest: CV_REQUEST_URL,
    note: 'For client and project specifics, request the full CV through the form at ' + CV_REQUEST_URL + '.',
  };
}

export function experienceData() {
  return {
    roles: experience.map((r) => ({
      id: r.id,
      title: r.title,
      company: r.company,
      companyUrl: r.companyUrl ?? null,
      parent: r.parent ?? null,
      place: r.place,
      start: r.start,
      end: r.end,
      dates: roleSpan(r),
      summary: r.summary,
      highlights: r.highlights,
      steps: (r.steps ?? []).map((s) => ({ ...s, dates: `${fmtMonth(s.start)} – ${fmtMonth(s.end)}` })),
      stack: r.stack,
    })),
    education: { ...education },
  };
}

export function projectsData() {
  return publishedProjects.map((p) => ({
    id: p.id,
    name: p.name,
    tagline: p.tagline,
    description: p.description,
    kind: p.kind,
    year: p.year,
    stack: p.stack,
    repo: p.repo ?? null,
    live: p.live ?? null,
  }));
}

export function certificationsData() {
  return certifications.map((c) => ({ id: c.id, name: c.name, short: c.short, level: c.level, verifyUrl: c.verifyUrl }));
}

export function summaryData() {
  return {
    name: person.name,
    irishName: person.irishName,
    role: person.role,
    employer: person.employer,
    location: person.location,
    origin: person.origin,
    headline: person.headline,
    oneLiner: person.oneLiner,
    summary: [...person.summary],
    yearsOfExperience: yearsOfExperience(),
    now: { updated: now.updated, items: [...now.items] },
    links: { ...person.links },
    site: SITE,
  };
}

export function sectionData(section: ProfileSection): Record<string, unknown> {
  switch (section) {
    case 'summary':
      return summaryData();
    case 'experience':
      return experienceData();
    case 'capabilities':
      return { capabilities: capabilities.map((c) => ({ ...c })) };
    case 'certifications':
      return { certifications: certificationsData() };
    case 'projects':
      return { projects: projectsData() };
    case 'skills':
      return { skills: skills.map((g) => ({ ...g })) };
    case 'writing':
      return { writing: writing.map((w) => ({ ...w })) };
    case 'music':
      return { music: { ...music } };
    case 'contact':
      return contactOptions();
  }
}

/** Everything public, as one JSON document (MCP resource liam://profile.json). */
export function profileJson(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of PROFILE_SECTIONS) out[s] = sectionData(s);
  out.privacy = PRIVACY_NOTE;
  return out;
}

export function sectionMarkdown(section: ProfileSection): string {
  const L: string[] = [];
  switch (section) {
    case 'summary': {
      L.push(`# ${person.name}`, '', `> ${person.oneLiner}`, '', ...person.summary, '');
      L.push(`- Role: ${person.role} at ${person.employer}`);
      L.push(`- Location: ${person.location} (from ${person.origin})`);
      L.push(`- Experience: ${yearsOfExperience()} years (since ${fmtMonth(person.careerStart.slice(0, 7))})`);
      L.push('', `## Now (${now.updated})`, ...now.items.map((n) => `- ${n}`));
      break;
    }
    case 'experience': {
      L.push('# Experience');
      for (const r of experience) {
        L.push('', `## ${r.title} · ${r.company}${r.parent ? ` (${r.parent})` : ''}`, `${roleSpan(r)} · ${r.place}`, '', r.summary);
        if (r.steps) L.push('', ...r.steps.map((s) => `- ${s.title}: ${fmtMonth(s.start)} – ${fmtMonth(s.end)}`));
        L.push('', ...r.highlights.map((h) => `- ${h}`), '', `Stack: ${r.stack.join(', ')}`);
      }
      L.push('', '## Education', `- ${education.qualification}, ${education.institution} (${education.start}–${education.end}). ${education.project}`);
      break;
    }
    case 'capabilities': {
      L.push('# Capabilities');
      for (const c of capabilities) L.push('', `## ${c.title}`, c.blurb, ...c.points.map((p) => `- ${p}`), `Tools: ${c.tools.join(', ')}`);
      break;
    }
    case 'certifications': {
      L.push('# Microsoft certifications', '');
      L.push(...certifications.map((c) => `- [${c.name}](${c.verifyUrl}) (${c.level})`));
      L.push('', 'Each link verifies the credential on Microsoft Learn.');
      break;
    }
    case 'projects': {
      L.push('# Projects', '');
      for (const p of publishedProjects) {
        const links = [p.repo ? `[source](${p.repo})` : '', p.live ? `[live](${p.live})` : ''].filter(Boolean).join(' · ');
        L.push(`- **${p.name}** (${p.year}, ${p.kind}): ${p.tagline} ${p.description} Stack: ${p.stack.join(', ')}.${links ? ` ${links}` : ''}`);
      }
      break;
    }
    case 'skills': {
      L.push('# Skills', '', ...skills.map((g) => `- ${g.group}: ${g.items.join(', ')}`));
      break;
    }
    case 'writing': {
      L.push('# Writing', '', ...writing.map((w) => `- [${w.title}](${w.href}) (${w.date}): ${w.summary}`));
      break;
    }
    case 'music': {
      L.push('# Outside work', '');
      L.push(`- ${music.band} (${music.role}, since ${music.formed}): ${music.blurb} ${music.bandUrl}`);
      break;
    }
    case 'contact': {
      const c = contactOptions();
      L.push('# Contact', '', `- Email: ${c.email}`, `- LinkedIn: ${c.linkedin}`, `- GitHub: ${c.github}`, `- Full CV (client detail on request): ${c.cvRequest}`);
      break;
    }
  }
  if (section !== 'contact') L.push('', '---', PRIVACY_NOTE);
  return L.join('\n');
}
