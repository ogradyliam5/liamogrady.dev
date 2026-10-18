import type { BuildContext } from './context';
import {
  SITE,
  person,
  publishedProjects,
  certifications,
  writing,
  music,
  profileMarkdown,
  capabilities,
} from '../shared/knowledge';
import { MCP_TOOLS_SUMMARY } from '../shared/mcp-summary';

/** Plain-text and JSON files written next to the HTML at build time. */
export function textFiles(ctx: BuildContext): Record<string, string> {
  const files: Record<string, string> = {};

  // llms.txt (llmstxt.org): a short, link-rich map for language models.
  files['llms.txt'] = [
    `# ${person.name}`,
    '',
    `> ${person.oneLiner}`,
    '',
    `${person.givenName} is based in ${person.location} and is originally from ${person.origin}. This site is built to be read by people and by agents: every fact here is also available through a public, read-only MCP server.`,
    '',
    '## Profile',
    `- [Full profile in Markdown](${SITE}/llms-full.txt): experience, capabilities, certifications, projects and writing in one file`,
    `- [Printable CV](${SITE}/cv): the same profile as a clean, printable page`,
    `- [LinkedIn](${person.links.linkedin})`,
    `- [GitHub](${person.links.github})`,
    '',
    '## For agents',
    `- [MCP server](${SITE}/mcp): Model Context Protocol over Streamable HTTP, no auth, read-only. ${MCP_TOOLS_SUMMARY}`,
    `- [How to connect](${SITE}/agents): one-click install for VS Code, Claude, ChatGPT, Copilot Studio and others`,
    '',
    '## Capabilities',
    ...capabilities.map((c) => `- ${c.title}: ${c.blurb}`),
    '',
    '## Projects',
    ...publishedProjects.map((p) => `- [${p.name}](${p.live ?? p.repo}): ${p.tagline}`),
    '',
    '## Certifications',
    ...certifications.map((c) => `- [${c.name}](${c.verifyUrl})`),
    '',
    '## Writing',
    ...writing.map((w) => `- [${w.title}](${w.href})`),
    '',
    '## Optional',
    `- [${music.band}](${music.bandUrl}): ${person.givenName} plays ${music.role} in this Galway folk and trad trio`,
    `- [Colophon](${SITE}/colophon): how this site is built`,
    '',
  ].join('\n');

  files['llms-full.txt'] = profileMarkdown() + '\n';

  files['robots.txt'] = [
    '# Humans and agents are both welcome.',
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    '',
    `Sitemap: ${SITE}/sitemap.xml`,
    '',
  ].join('\n');

  const pages = ['/', '/cv', '/agents', '/colophon'];
  files['sitemap.xml'] =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    pages.map((p) => `  <url><loc>${SITE}${p === '/' ? '/' : p}</loc><lastmod>${ctx.builtAt.slice(0, 10)}</lastmod></url>`).join('\n') +
    '\n</urlset>\n';

  files['humans.txt'] = [
    '/* TEAM */',
    `  Architect and engineer: ${person.name}`,
    `  Site: ${SITE}`,
    `  From: ${person.origin} · Lives: ${person.location}`,
    '',
    '/* SITE */',
    '  Standards: HTML, CSS, TypeScript, WebGPU, WGSL, GLSL ES 3.0',
    '  Runtime: Cloudflare Workers, Durable Objects; agent model: OpenAI GPT-6 Luna',
    `  Dependencies: ${ctx.stats.dependencies}`,
    `  Build: ${ctx.git.sha} · ${ctx.builtAt}`,
    '',
  ].join('\n');

  const expires = new Date(Date.parse(ctx.builtAt) + 365 * 24 * 3600 * 1000).toISOString();
  files['.well-known/security.txt'] = [
    `Contact: mailto:${person.email}`,
    `Expires: ${expires}`,
    'Preferred-Languages: en',
    `Canonical: ${SITE}/.well-known/security.txt`,
    '',
  ].join('\n');

  files['manifest.webmanifest'] = JSON.stringify(
    {
      name: `${person.name}: ${person.role}`,
      short_name: person.initials,
      start_url: '/',
      display: 'standalone',
      background_color: '#05070b',
      theme_color: '#05070b',
      icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
    },
    null,
    2,
  );

  return files;
}
