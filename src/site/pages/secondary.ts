import { html, raw, type Raw } from '../html';
import { icon } from '../icons';
import type { BuildContext } from '../context';
import { layout } from '../layout';
import {
  person,
  experience,
  education,
  certifications,
  capabilities,
  skills,
  publishedProjects,
  writing,
  music,
  fmtMonth,
  roleSpan,
  yearsOfExperience,
} from '../../shared/knowledge';
import { MCP_TOOLS_SUMMARY } from '../../shared/mcp-summary';

const page = (inner: Raw) => html`<div class="shell page-pad">${inner}</div>`;

/** A clean, printable CV — also the no-JavaScript, low-power and screen-reader-first view. */
export function cvPage(ctx: BuildContext): string {
  const body = page(html`<article class="cv stack measure-52">
  <header class="stack">
    <span class="eyebrow">Curriculum vitae · updated ${ctx.builtAt.slice(0, 10)}</span>
    <h1 class="title">${person.name}</h1>
    <p class="lede">${person.oneLiner}</p>
    <p class="muted">${person.location} · <a href="mailto:${person.email}">${person.email}</a> · <a href="${person.links.linkedin}">LinkedIn</a> · <a href="${person.links.github}">GitHub</a></p>
    <p class="row muted small">Print or save as PDF with <kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>P</kbd> · <a href="/llms-full.txt">Markdown version</a></p>
  </header>
  <section class="stack"><h2 class="eyebrow">Profile</h2>${person.summary.map((p) => html`<p class="prose">${p}</p>`)}</section>
  <section class="stack"><h2 class="eyebrow">Experience · ${yearsOfExperience()} years</h2>
    ${experience.map(
      (r) => html`<div class="stack entry">
        <h3 class="fs-1">${r.title}, ${r.company}${r.parent ? html` <span class="muted">(${r.parent})</span>` : ''}</h3>
        <p class="muted mono fs--2">${roleSpan(r)} · ${r.place}</p>
        ${r.steps ? html`<p class="muted small">${r.steps.map((s) => `${s.title} (${fmtMonth(s.start)} – ${fmtMonth(s.end)})`).join(' → ')}</p>` : ''}
        <p class="prose">${r.summary}</p>
        <ul class="prose list">${r.highlights.map((h) => html`<li>${h}</li>`)}</ul>
      </div>`,
    )}
  </section>
  <section class="stack"><h2 class="eyebrow">Education</h2><p class="prose"><strong>${education.qualification}</strong>, ${education.institution} (${education.start}–${education.end}). ${education.project}</p></section>
  <section class="stack"><h2 class="eyebrow">Certifications</h2><ul class="prose list">${certifications.map((c) => html`<li><a href="${c.verifyUrl}">${c.name}</a></li>`)}</ul></section>
  <section class="stack"><h2 class="eyebrow">Capabilities</h2><ul class="prose list">${capabilities.map((c) => html`<li><strong>${c.title}.</strong> ${c.blurb}</li>`)}</ul></section>
  <section class="stack"><h2 class="eyebrow">Skills</h2><ul class="prose list">${skills.map((g) => html`<li><strong>${g.group}:</strong> ${g.items.join(', ')}</li>`)}</ul></section>
  <section class="stack"><h2 class="eyebrow">Open source &amp; side projects</h2><ul class="prose list">${publishedProjects.map((p) => html`<li><a href="${p.live ?? p.repo}">${p.name}</a>: ${p.tagline}</li>`)}</ul></section>
  <section class="stack"><h2 class="eyebrow">Writing</h2><ul class="prose list">${writing.map((w) => html`<li><a href="${w.href}">${w.title}</a> (${w.date})</li>`)}</ul></section>
  <section class="stack"><h2 class="eyebrow">Outside work</h2><p class="prose">Banjo with <a href="${music.bandUrl}">${music.band}</a>, ${music.blurb}</p></section>
  <p class="muted small">Client names, project specifics and metrics are deliberately not public. <a href="/#contact">Request the full CV</a>.</p>
</article>`);
  return layout(ctx, { path: '/cv', title: `CV · ${person.name}`, description: `The printable CV of ${person.name}, ${person.role} at ${person.employer}.`, app: false, bodyClass: 'is-cv' }, body);
}

export function agentsPage(ctx: BuildContext): string {
  const url = 'https://liamogrady.dev/mcp';
  const body = page(html`<article class="stack measure-60 gap-6">
  <header class="stack">
    <span class="eyebrow">Developers</span>
    <h1 class="title">Connect your AI tools to this site</h1>
    <p class="lede">The profile on this site is available to AI tools as an MCP server and as plain files. Everything is read-only.</p>
  </header>
  <section class="card stack">
    <h2 class="h2">MCP server</h2>
    <pre class="code" tabindex="0">${url}</pre>
    <p class="prose">Model Context Protocol over Streamable HTTP (current spec, with 2025-era clients supported). No authentication, rate-limited, read-only. ${MCP_TOOLS_SUMMARY} Resources: <code>liam://profile.md</code>, <code>liam://profile.json</code>. Prompts: <code>introduce_liam</code>, <code>assess_fit</code>.</p>
    <h3 class="eyebrow">Connect</h3>
    <pre class="code" tabindex="0"><span class="c"># Claude Code</span>
claude mcp add --transport http liam ${url}

<span class="c"># VS Code (or use the one-click link on the home page)</span>
code --add-mcp '{"name":"liam-ogrady","type":"http","url":"${url}"}'

<span class="c"># Copilot Studio</span>
Tools → Add a tool → New tool → Model Context Protocol → URL above → Authentication: None

<span class="c"># Microsoft 365 Copilot (Agents Toolkit)</span>
Declarative agent → Add an action → Start with an MCP server → URL above</pre>
  </section>
  <section class="card stack">
    <h2 class="h2">WebMCP</h2>
    <p class="prose">When a browser agent supports WebMCP (<code>document.modelContext</code>), the home page registers tools for it directly: <code>search_profile</code>, <code>get_section</code>, <code>navigate</code> and <code>open_agent</code>. They run in the visitor's browser and never send data anywhere else.</p>
  </section>
  <section class="card stack">
    <h2 class="h2">Plain files</h2>
    <ul class="prose list">
      <li><a href="/llms.txt">/llms.txt</a>: a short map of the site for language models</li>
      <li><a href="/llms-full.txt">/llms-full.txt</a>: the whole profile in Markdown</li>
      <li><a href="/cv">/cv</a>: printable HTML CV with schema.org JSON-LD</li>
      <li><code>curl liamogrady.dev</code>: an ANSI CV for terminals</li>
    </ul>
  </section>
  <section class="card stack">
    <h2 class="h2">The chat API</h2>
    <p class="prose"><code>POST /api/agent</code> streams Server-Sent Events: <code>meta</code>, <code>status</code>, <code>tool</code>, <code>tool_result</code>, <code>ui</code>, <code>card</code>, <code>text</code>, <code>done</code>. UI events let the chat scroll and highlight this page. It only uses the public profile, does not discuss clients, and falls back to plain search when the model is unavailable or the daily budget is spent.</p>
  </section>
</article>`);
  return layout(ctx, { path: '/agents', title: `Developers · ${person.name}`, description: 'Connect your AI tools to Liam O\u2019Grady\u2019s public profile: MCP server, llms.txt and a terminal CV.' }, body);
}

export function colophonPage(ctx: BuildContext): string {
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  const body = page(html`<article class="stack measure-60 gap-6">
  <header class="stack">
    <span class="eyebrow">Colophon</span>
    <h1 class="title">How this site is built</h1>
    <p class="lede">A static site on a Cloudflare Worker, a particle animation written from scratch for the GPU, a chat that uses OpenAI, and an MCP server.</p>
  </header>
  <section class="card stack">
    <h2 class="h2">By the numbers (this build)</h2>
    <ul class="prose list">
      <li>Build <code>${ctx.git.sha}</code>, ${ctx.builtAt.slice(0, 16).replace('T', ' ')} UTC</li>
      <li>Front-end dependencies: <strong>${ctx.stats.dependencies}</strong></li>
      <li>JavaScript: ${kb(ctx.stats.jsGzipBytes)} gzipped across ${ctx.stats.jsFiles} files; ${kb(ctx.stats.entryGzipBytes)} before anything is lazy-loaded</li>
      <li>CSS: ${kb(ctx.stats.cssGzipBytes)} gzipped, inlined; HTML: ${kb(ctx.stats.htmlGzipBytes ?? 0)} gzipped</li>
      <li>Particles: up to 1,048,576 on WebGPU, 262,144 on WebGL2, adapted to your device's frame rate</li>
    </ul>
  </section>
  <section class="card stack">
    <h2 class="h2">Stack</h2>
    <ul class="prose list">
      <li><strong>Edge:</strong> Cloudflare Workers with static assets, Durable Objects for live presence (WebSocket hibernation) and the agent's daily token budget, the Rate Limiting binding and Turnstile.</li>
      <li><strong>Swarm:</strong> a hand-written particle engine. WGSL compute and render passes on WebGPU, a GLSL ES 3.0 GPGPU fallback on WebGL2, divergence-free simplex flow, a 5-level bloom chain and ACES tone mapping. Every formation (the orchestrator, the agent graph, the Galway to London flight path) is generated from code: no models, no textures.</li>
      <li><strong>Pages:</strong> TypeScript templates rendered at build time; no framework, no hydration. CSS layers, container-friendly fluid type, View Transitions where supported.</li>
      <li><strong>Agent:</strong> OpenAI GPT-6 Luna through the Responses API, called only from the Worker. Tool calls are validated server-side, answers are grounded in the public profile, and a deterministic fallback answers when the model is unavailable or the daily budget is spent.</li>
      <li><strong>For other agents:</strong> a stateless MCP server (Streamable HTTP), WebMCP tools in the page, llms.txt and JSON-LD.</li>
      <li><strong>Accessibility:</strong> all content is real HTML; the canvas is decorative. Reduced-motion settles the swarm into still frames. Every agent action is reachable by keyboard.</li>
    </ul>
  </section>
  <section class="card stack">
    <h2 class="h2">Type and colour</h2>
    <p class="prose">Instrument Serif for headings, Geist for text and Geist Mono for code, all under the SIL Open Font License. The accent colours are gold and cyan.</p>
  </section>
  <p class="muted">Press <kbd>X</kbd> on the home page for live performance figures.</p>
</article>`);
  return layout(ctx, { path: '/colophon', title: `Colophon · ${person.name}`, description: 'How liamogrady.dev is built: Cloudflare Workers, a hand-written WebGPU engine, an on-site agent and an MCP server.' }, body);
}

export function notFoundPage(ctx: BuildContext): string {
  const body = page(html`<div class="stack measure-44">
    <span class="eyebrow">404</span>
    <h1 class="display fs-4">Page not found</h1>
    <p class="lede">That page doesn't exist. Try the home page, or ask a question.</p>
    <div class="row"><a class="btn btn--primary" href="/">${icon('arrow')}<span>Home</span></a><button class="btn" type="button" data-agent-open>${icon('spark')}<span>Ask a question</span></button></div>
  </div>`);
  return layout(ctx, { path: '/404', title: `Not found · ${person.name}`, description: 'Page not found.' }, body);
}

export { raw };
