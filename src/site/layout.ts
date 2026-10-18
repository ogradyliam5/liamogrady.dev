import { createHash } from 'node:crypto';
import { html, raw, type Raw } from './html';
import { icon } from './icons';
import { SITE_URL, type BuildContext } from './context';
import { person, certifications, capabilities, education } from '../../content/profile';

const sha = (s: string) => createHash('sha256').update(s).digest('base64');

/** Dev-site builds (LOD_SITE_ENV=dev) are marked in the tab title and kept out of search engines. */
const IS_DEV_SITE = process.env.LOD_SITE_ENV === 'dev';

/** Optional Chrome WebMCP origin-trial token, set at build time: WEBMCP_ORIGIN_TRIAL=<token> npm run build. */
const originTrial = (): Raw | null => {
  const token = (process.env.WEBMCP_ORIGIN_TRIAL ?? '').trim();
  return token ? html`\n<meta http-equiv="origin-trial" content="${token}">` : null;
};

/** Register an inline script/style with the CSP and return the tag. */
function inlineScript(ctx: BuildContext, js: string, type?: string): Raw {
  ctx.cspHashes.script.add(sha(js));
  return raw(`<script${type ? ` type="${type}"` : ''}>${js}</script>`);
}
function inlineStyle(ctx: BuildContext, css: string): Raw {
  ctx.cspHashes.style.add(sha(css));
  return raw(`<style>${css}</style>`);
}

export type PageMeta = {
  path: string;
  title: string;
  description: string;
  /** Extra class on <body>. */
  bodyClass?: string;
  /** Whether to boot the swarm / agent client (home and colophon do; /cv stays static). */
  app?: boolean;
};

const NAV = [
  ['about', 'About'],
  ['capabilities', 'What I do'],
  ['work', 'Projects'],
  ['journey', 'Experience'],
  ['credentials', 'Credentials'],
  ['writing', 'Writing'],
  ['agents', 'Developers'],
  ['contact', 'Contact'],
] as const;

export function jsonLd(): string {
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ProfilePage',
        '@id': `${SITE_URL}/#profile`,
        url: `${SITE_URL}/`,
        name: `${person.name} — ${person.role}`,
        mainEntity: { '@id': `${SITE_URL}/#person` },
        dateModified: new Date().toISOString().slice(0, 10),
      },
      {
        '@type': 'Person',
        '@id': `${SITE_URL}/#person`,
        name: person.name,
        alternateName: person.irishName,
        givenName: person.givenName,
        familyName: person.familyName,
        jobTitle: person.role,
        description: person.oneLiner,
        url: `${SITE_URL}/`,
        email: `mailto:${person.email}`,
        worksFor: { '@type': 'Organization', name: person.employer, url: person.employerUrl },
        homeLocation: { '@type': 'Place', name: person.location },
        alumniOf: { '@type': 'CollegeOrUniversity', name: education.institution },
        knowsAbout: [...new Set(capabilities.flatMap((c) => [c.title, ...c.tools]))],
        hasCredential: certifications.map((c) => ({
          '@type': 'EducationalOccupationalCredential',
          name: c.name,
          credentialCategory: 'certification',
          recognizedBy: { '@type': 'Organization', name: 'Microsoft' },
          url: c.verifyUrl,
        })),
        sameAs: [person.links.linkedin, person.links.github, person.links.medium],
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#site`,
        url: `${SITE_URL}/`,
        name: person.name,
        inLanguage: 'en-GB',
      },
    ],
  };
  return JSON.stringify(graph).replace(/</g, '\\u003c');
}

export function layout(ctx: BuildContext, meta: PageMeta, body: Raw): string {
  const app = meta.app !== false;
  const canonical = `${SITE_URL}${meta.path === '/' ? '/' : meta.path}`;
  // Runs before first paint: progressive-enhancement flags with no flash.
  const boot = `document.documentElement.classList.replace('no-js','js');try{if(sessionStorage.getItem('xray')==='1')document.documentElement.classList.add('xray-on')}catch(e){}`;
  const speculation = JSON.stringify({ prefetch: [{ source: 'document', where: { href_matches: '/*' }, eagerness: 'moderate' }] });
  const isHome = meta.path === '/';
  const navHref = (id: string) => (isHome ? `#${id}` : `/#${id}`);

  return (
    '<!doctype html>' +
    html`<html lang="en-GB" class="no-js" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${IS_DEV_SITE ? '[dev] ' : ''}${meta.title}</title>${IS_DEV_SITE ? raw('\n<meta name="robots" content="noindex, nofollow">') : ''}
<meta name="description" content="${meta.description}">
<link rel="canonical" href="${canonical}">
<meta name="theme-color" content="#05070b">
<meta name="color-scheme" content="dark">${originTrial()}
<meta name="author" content="${person.name}">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="${person.name}">
<meta property="og:title" content="${meta.title}">
<meta property="og:description" content="${meta.description}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${SITE_URL}/og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Liam O'Grady: a swarm of light orbiting a bright core, with the words AI Architect">
<meta property="profile:first_name" content="${person.givenName}">
<meta property="profile:last_name" content="${person.familyName}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="alternate" type="text/markdown" href="/llms-full.txt" title="Profile in Markdown">
<link rel="describedby" href="/llms.txt">
<link rel="preload" href="/fonts/geist.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/instrument-serif.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/instrument-serif-italic.woff2" as="font" type="font/woff2" crossorigin>
${inlineScript(ctx, boot)}
${inlineStyle(ctx, ctx.assets.css)}
<script type="application/ld+json">${raw(jsonLd())}</script>
${inlineScript(ctx, speculation, 'speculationrules')}
${app ? raw(`<script type="module" src="${ctx.assets.mainJs}"></script>`) : ''}
</head>
<body class="${meta.bodyClass ?? ''}" data-build="${ctx.git.sha}">
<a class="skip-link" href="#main">Skip to content</a>
${app ? html`<div class="stage" aria-hidden="true"><canvas id="swarm"></canvas></div><div class="peers" aria-hidden="true"></div>` : ''}
<header class="site-header" data-xray="&lt;header&gt; · sticky, backdrop-filter">
  <nav class="nav shell" aria-label="Main">
    <a class="brand" href="/">
      <span class="brand-mark" aria-hidden="true">LOG</span>
      <span class="brand-name">${person.name}<small>${person.role} · ${person.employer}</small></span>
    </a>
    <ul class="nav-links" role="list">
      ${NAV.map(([id, label]) => html`<li><a href="${navHref(id)}" data-nav="${id}">${label}</a></li>`)}
    </ul>
    <div class="nav-actions">
      ${app ? html`<button class="btn btn--small btn--primary" type="button" data-agent-open aria-haspopup="dialog">${icon('spark')}<span>Ask a question</span> <kbd aria-hidden="true">/</kbd></button>` : html`<a class="btn btn--small" href="/">${icon('arrow')}<span>Home</span></a>`}
    </div>
  </nav>
</header>
<main id="main" tabindex="-1">
${body}
</main>
${footer(ctx)}
${app ? agentChrome() : ''}
</body>
</html>`.value
  );
}

function footer(ctx: BuildContext): Raw {
  return html`<footer class="site-footer" data-xray="&lt;footer&gt; · build ${ctx.git.sha}">
  <div class="shell footer-grid">
    <div class="colophon-line">
      <span>© ${new Date().getFullYear()} ${person.name}</span>
      <span>${person.location}</span>
    </div>
    <div class="colophon-line">
      <a href="/cv">Printable CV</a>
      <a href="/agents">Developers</a>
      <a href="/colophon">How this site is built</a>
      <a href="/llms.txt">llms.txt</a>
      <a href="${person.links.github}" rel="me">GitHub</a>
      <a href="${person.links.linkedin}" rel="me">LinkedIn</a>
    </div>
  </div>
</footer>`;
}

/** Agent dock + panel + x-ray HUD shells. Behaviour is attached by the client bundle. */
function agentChrome(): Raw {
  return html`<aside class="dock" data-dock aria-label="Ask about Liam" data-xray="agent dock · /api/agent (SSE)">
  <form class="dock-bar" data-dock-form role="search" aria-label="Ask a question about Liam">
    <span class="spark" aria-hidden="true"></span>
    <label class="sr-only" for="dock-input">Ask about Liam's work, or paste a job description</label>
    <input id="dock-input" name="q" type="text" autocomplete="off" maxlength="4000" placeholder="Ask about Liam's work, or paste a job description" data-short="Ask a question" data-dock-input>
    <button class="btn btn--small btn--primary" type="submit">${icon('send')}<span class="sr-only">Ask</span></button>
  </form>
  <div class="dock-hints" role="group" aria-label="Suggested questions">
    <button type="button" data-ask="fit">Check a job description</button>
    <button type="button" data-ask="architect">Suggest an architecture</button>
    <button type="button" data-ask="What has Liam built with MCP?">What has he built?</button>
  </div>
</aside>
<section class="panel" data-panel role="dialog" aria-modal="false" aria-labelledby="panel-title" aria-hidden="true">
  <header class="panel-head">
    <span class="spark" aria-hidden="true"></span>
    <h2 id="panel-title">Ask about Liam</h2>
    <span class="chip" data-agent-model>public profile only</span>
    <button class="btn btn--small panel-new" type="button" data-agent-new disabled title="Start a new chat">${icon('plus')}<span>New chat</span></button>
    <button class="btn btn--small" type="button" data-agent-close aria-label="Close the chat">${icon('close')}</button>
  </header>
  <div class="panel-log" data-log aria-live="polite" aria-relevant="additions"></div>
  <footer class="panel-foot">
    <div class="modes" role="group" aria-label="Mode">
      <button type="button" data-mode="chat" aria-pressed="true">Question</button>
      <button type="button" data-mode="fit" aria-pressed="false">Job fit</button>
      <button type="button" data-mode="architect" aria-pressed="false">Architecture</button>
    </div>
    <form data-agent-form>
      <label class="sr-only" for="agent-input">Message</label>
      <textarea id="agent-input" rows="1" maxlength="8000" placeholder="Ask a question" data-agent-input></textarea>
      <button class="btn btn--primary" type="submit">${icon('send')}<span class="sr-only">Send</span></button>
    </form>
  </footer>
</section>
<aside class="hud" data-hud hidden aria-label="X-ray telemetry"></aside>`;
}
