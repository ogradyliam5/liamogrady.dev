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
  writing,
  music,
  publishedProjects,
  fmtMonth,
  roleSpan,
} from '../../shared/knowledge';

const MCP_URL = 'https://liamogrady.dev/mcp';
const vscodeLink = 'vscode:mcp/install?' + encodeURIComponent(JSON.stringify({ name: 'liam-ogrady', type: 'http', url: MCP_URL }));
const cursorLink = `cursor://anysphere.cursor-deeplink/mcp/install?name=liam-ogrady&config=${btoa(JSON.stringify({ url: MCP_URL }))}`;

/** Split a display heading into lines for the reveal animation (lines are authored with |). */
function splitLines(text: string): Raw {
  return raw(
    text
      .split('|')
      .map((line, i) => `<span class="split-line" data-l="${i}"><span>${line.trim()}</span></span>`)
      .join(''),
  );
}

function sectionHead(index: string, eyebrow: string, title: string, lede?: string): Raw {
  return html`<div class="section-head">
    <span class="eyebrow reveal"><span>${index}</span> ${eyebrow}</span>
    <h2 class="title split">${splitLines(title)}</h2>
    ${lede ? html`<p class="lede reveal" data-i="2">${lede}</p>` : ''}
  </div>`;
}

function hero(): Raw {
  return html`<section class="scene hero" id="top" data-scene="orbits" data-place="hero" data-xray="&lt;section#top&gt; · scene: orbits (the orchestrator)">
  <div class="shell grid">
    <div class="hero-inner">
      <h1>
        <span class="display">${splitLines(`${person.name}.`)}</span>
        <span class="who reveal" data-i="2">${person.role} at ${person.employer}, London.</span>
      </h1>
      <div class="hero-actions reveal" data-i="3">
        <button class="btn btn--primary" type="button" data-agent-open>${icon('spark')}<span>Ask about my work</span></button>
        <a class="btn" href="#work">${icon('arrow')}<span>See my projects</span></a>
      </div>
    </div>
  </div>
</section>`;
}

function about(): Raw {
  return html`<section class="scene" id="about" data-scene="fields" data-place="right" data-xray="&lt;section#about&gt; · scene: fields (procedural)">
  <div class="shell grid">
    <div class="col-copy">
      ${sectionHead('01', '', 'About')}
      <div class="prose reveal" data-i="3">
        <p>I'm an AI Architect in Avanade's Data &amp; AI practice in London. I design and build AI agents for organisations on Microsoft 365, mostly with Copilot Studio, Microsoft Foundry and the Power Platform.</p>
        <p>Before Avanade I spent nearly seven years on Dynamics 365 and the Power Platform: at a Microsoft partner in Galway, then at Air Partner in London, where I went from engineer to solution architect, and most recently leading the AI practice at DigPacks. Most of what makes an agent work well is the process and data behind it, so that is where I start.</p>
      </div>
      <ol class="roots-steps" role="list" aria-label="How I work">
        <li class="reveal" data-i="1"><span class="when">01</span><div><strong>Process and data first</strong><span>Most agent problems turn out to be process or data problems. I sort those out before building anything.</span></div></li>
        <li class="reveal" data-i="2"><span class="when">02</span><div><strong>Plan for production</strong><span>Deployment, approvals, monitoring and responsible AI reviews are planned from the start.</span></div></li>
        <li class="reveal" data-i="3"><span class="when">03</span><div><strong>Reuse what works</strong><span>When something comes up twice, I turn it into a template, a tool or a training session.</span></div></li>
      </ol>
      <p class="muted small reveal" data-i="4">Outside work, I play banjo with <a href="${music.bandUrl}" rel="noopener">${music.band}</a>, ${music.blurb}</p>
    </div>
  </div>
</section>`;
}

function capabilitiesSection(): Raw {
  return html`<section class="scene" id="capabilities" data-scene="graph" data-place="right-wide" data-xray="&lt;section#capabilities&gt; · scene: agent graph">
  <div class="shell">
    <div class="grid"><div class="col-copy">${sectionHead('02', '', 'What I do', 'Architecture, delivery and governance for AI agents on the Microsoft stack, plus the Power Platform and Dynamics 365 work underneath.')}</div></div>
    <ul class="caps" role="list">
      ${capabilities.map(
        (c, i) => html`<li class="card cap reveal" data-i="${i % 3}" id="cap-${c.id}" data-highlight="cap:${c.id}">
          <span class="cap-num">${String(i + 1).padStart(2, '0')} / ${String(capabilities.length).padStart(2, '0')}</span>
          <h3>${c.title}</h3>
          <p>${c.blurb}</p>
          <ul>${c.points.slice(0, 3).map((p) => html`<li>${p}</li>`)}</ul>
          <ul class="tags" role="list" aria-label="Tools">${c.tools.map((t) => html`<li>${t}</li>`)}</ul>
        </li>`,
      )}
    </ul>
  </div>
</section>`;
}

function work(): Raw {
  return html`<section class="scene" id="work" data-scene="constellation" data-place="right" data-xray="&lt;section#work&gt; · scene: constellation (one cluster per project)">
  <div class="shell">
    <div class="grid"><div class="col-copy">${sectionHead('03', '', 'Projects', 'Open-source tools I have built in my own time, mostly for connecting agents to other systems. I use AI coding agents for a lot of the implementation and do the design, review and release myself.')}</div></div>
    <ul class="work-list" role="list">
      ${publishedProjects.map(
        (p, i) => html`<li class="card project reveal" data-i="${i % 3}" id="project-${p.id}" data-highlight="project:${p.id}">
          <span class="project-glyph" aria-hidden="true">${icon(p.glyph)}</span>
          <div>
            <h3><a href="${p.live ?? p.repo}" rel="noopener">${p.name}</a></h3>
            <p class="tagline">${p.tagline}</p>
            <p class="desc">${p.description}</p>
            <ul class="tags" role="list" aria-label="Stack">${p.stack.map((s) => html`<li>${s}</li>`)}</ul>
          </div>
          <div class="project-meta">
            <span>${p.year} · ${p.kind.replace('-', ' ')}</span>
            ${p.repo ? html`<a href="${p.repo}" rel="noopener">source ${icon('external')}</a>` : ''}
            ${p.live ? html`<a href="${p.live}" rel="noopener">live ${icon('external')}</a>` : ''}
          </div>
        </li>`,
      )}
    </ul>
    <p class="muted reveal mt-6">More on <a href="${person.links.github}" rel="me">GitHub</a>. Client work stays confidential; the full CV has the detail.</p>
  </div>
</section>`;
}

function journey(): Raw {
  return html`<section class="scene" id="journey" data-scene="journey" data-place="right" data-xray="&lt;section#journey&gt; · scene: Galway → London flight path">
  <div class="shell grid">
    <div class="col-copy">
      ${sectionHead('04', '', 'Experience')}
      <ol class="timeline" role="list">
        ${experience.map(
          (r, i) => html`<li class="role reveal${r.end === null ? ' is-current' : ''}" data-i="${i}" id="role-${r.id}" data-highlight="role:${r.id}">
            <span class="when">${roleSpan(r)} · ${r.place}</span>
            <h3>${r.title} <span class="at">${r.company}</span></h3>
            <p>${r.summary}</p>
            ${r.steps ? html`<div class="steps">${r.steps.map((s) => html`<span class="chip">${s.title} · ${fmtMonth(s.start).split(' ')[1]}</span>`)}</div>` : ''}
            <details><summary>Highlights</summary><ul>${r.highlights.map((h) => html`<li>${h}</li>`)}</ul></details>
          </li>`,
        )}
        <li class="role reveal" data-i="${experience.length}" id="role-education">
          <span class="when">${education.start} – ${education.end} · Galway</span>
          <h3>${education.qualification} <span class="at">ATU</span></h3>
          <p>${education.project}</p>
        </li>
      </ol>
    </div>
  </div>
</section>`;
}

function credentials(): Raw {
  return html`<section class="scene" id="credentials" data-scene="badges" data-place="top" data-xray="&lt;section#credentials&gt; · scene: badges">
  <div class="shell">
    <div class="grid"><div class="col-copy">${sectionHead('05', '', 'Certifications', 'Each one links to Microsoft Learn, where you can check it.')}</div></div>
    <ul class="certs" role="list">
      ${certifications.map(
        (c, i) => html`<li class="reveal" data-i="${i}"><a class="card cert${c.level === 'Expert' ? ' is-expert' : ''}" href="${c.verifyUrl}" rel="noopener" id="cert-${c.id}" data-highlight="cert:${c.id}">
          <span class="level">${c.level}</span>
          <strong>${c.short}</strong>
          <span class="verify">Verify on Microsoft <span class="nw">Learn${icon('external')}</span></span>
        </a></li>`,
      )}
    </ul>
  </div>
</section>`;
}

function writingSection(): Raw {
  return html`<section class="scene" id="writing" data-scene="drift" data-place="center" data-xray="&lt;section#writing&gt; · scene: drift">
  <div class="shell">
    <div class="grid"><div class="col-copy">${sectionHead('06', '', 'Writing', 'Articles on Copilot Studio and agent design.')}</div></div>
    <ul class="posts" role="list">
      ${writing.map(
        (w, i) => html`<li class="reveal" data-i="${i}"><a class="card post" href="${w.href}" rel="noopener">
          <time datetime="${w.date}">${new Date(w.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</time>
          <strong>${w.title}</strong>
          <span>${w.summary}</span>
        </a></li>`,
      )}
    </ul>
    <p class="muted reveal mt-6">More on <a href="${person.links.medium}" rel="me">Medium</a> and <a href="${person.links.linkedin}" rel="me">LinkedIn</a>.</p>
  </div>
</section>`;
}

function forAgents(): Raw {
  return html`<section class="scene" id="agents" data-scene="globe" data-place="right" data-xray="&lt;section#agents&gt; · scene: globe · /mcp (Streamable HTTP)">
  <div class="shell">
    <div class="grid"><div class="col-copy">${sectionHead('07', '', 'For developers', 'This site has a public MCP server. Add it to Copilot Studio, Microsoft 365 Copilot, VS Code, Claude or ChatGPT and they can answer questions about my experience from this profile.')}</div></div>
    <div class="agents-grid">
      <article class="card reveal" data-xray="MCP server · read-only · no auth · rate-limited">
        <span class="eyebrow">MCP server</span>
        <h3>Read-only, no sign-in</h3>
        <pre class="code" tabindex="0" data-copyable><span class="k">${MCP_URL}</span></pre>
        <div class="install-row">
          <a class="btn btn--small" href="${vscodeLink}">${icon('plug')}<span>Install in VS Code</span></a>
          <a class="btn btn--small" href="${cursorLink}">${icon('plug')}<span>Cursor</span></a>
          <button class="btn btn--small" type="button" data-copy="claude mcp add --transport http liam ${MCP_URL}">${icon('copy')}<span>Claude Code</span></button>
        </div>
        <p class="muted">In Copilot Studio: Tools → Add a tool → Model Context Protocol → paste the URL, authentication None.</p>
      </article>
      <article class="card reveal" data-i="1">
        <span class="eyebrow">Terminal</span>
        <h3>From a terminal</h3>
        <pre class="code" tabindex="0"><span class="c"># my CV, formatted for the terminal</span>
<span class="k">curl</span> <span class="s">liamogrady.dev</span>

<span class="c"># the whole profile as Markdown</span>
<span class="k">curl</span> <span class="s">liamogrady.dev/llms-full.txt</span></pre>
        <p class="muted">There is also an <a href="/llms.txt">llms.txt</a> and schema.org data for search engines and AI tools.</p>
      </article>
      <article class="card wide reveal" data-i="2">
        <span class="eyebrow">Rules</span>
        <div class="row">
          <span class="chip chip--cyan">${icon('shield')} public facts only</span>
          <span class="chip chip--cyan">read-only tools</span>
          <span class="chip chip--cyan">no client names</span>
          <span class="chip chip--cyan">rate-limited</span>
          <span class="chip chip--cyan">no cookies, no tracking</span>
        </div>
        <p class="muted">The chat on this site follows the same rules: it only uses what is published here and says when it doesn't know. <a href="/agents">More detail for developers</a>.</p>
      </article>
    </div>
  </div>
</section>`;
}

function contact(): Raw {
  return html`<section class="scene" id="contact" data-scene="signoff" data-place="watermark" data-xray="&lt;section#contact&gt; · POST /api/contact · Turnstile">
  <div class="shell">
    <div class="contact-grid">
      <div class="contact-copy">
        ${sectionHead('08', '', 'Contact', 'Get in touch about speaking, community events or open-source work. I am happy to send my full CV.')}
        <div class="contact-links reveal" data-i="3">
          <a class="btn" href="mailto:${person.email}">${icon('mail')}<span>${person.email}</span></a>
          <a class="btn" href="${person.links.linkedin}" rel="me">${icon('linkedin')}<span>LinkedIn</span></a>
          <a class="btn" href="${person.links.github}" rel="me">${icon('github')}<span>GitHub</span></a>
          <a class="btn" href="${person.links.medium}" rel="me">${icon('medium')}<span>Medium</span></a>
        </div>
      </div>
      <form class="card contact-form reveal" data-contact method="post" action="/api/contact" novalidate>
        <fieldset class="field">
          <legend>I'd like to</legend>
          <div class="segmented">
            <label><input type="radio" name="kind" value="cv" checked><span>Request the full CV</span></label>
            <label><input type="radio" name="kind" value="hello"><span>Send a message</span></label>
          </div>
        </fieldset>
        <div class="two">
          <div class="field"><label for="c-name">Name</label><input id="c-name" name="name" autocomplete="name" required maxlength="100"></div>
          <div class="field"><label for="c-email">Email</label><input id="c-email" name="email" type="email" autocomplete="email" required maxlength="200"></div>
        </div>
        <div class="field"><label for="c-company">Company (optional)</label><input id="c-company" name="company" autocomplete="organization" maxlength="120"></div>
        <div class="field"><label for="c-message">Message</label><textarea id="c-message" name="message" maxlength="2000" placeholder="What are you working on?"></textarea></div>
        <div class="hp" aria-hidden="true"><label for="c-website">Website</label><input id="c-website" name="website" tabindex="-1" autocomplete="off"></div>
        <div data-turnstile></div>
        <div class="row"><button class="btn btn--primary" type="submit">${icon('send')}<span>Send</span></button><p class="form-status" data-status role="status"></p></div>
      </form>
    </div>
  </div>
</section>`;
}

export function homePage(ctx: BuildContext): string {
  const body = html`${hero()}${about()}${capabilitiesSection()}${work()}${journey()}${credentials()}${writingSection()}${forAgents()}${contact()}`;
  return layout(
    ctx,
    {
      path: '/',
      title: `${person.name} · ${person.role} · Agentic AI on the Microsoft stack`,
      description: person.oneLiner,
    },
    body,
  );
}
