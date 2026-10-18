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
  yearsOfExperience,
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
  const years = yearsOfExperience();
  return html`<section class="scene hero" id="top" data-scene="orbits" data-place="hero" data-xray="&lt;section#top&gt; · scene: orbits (the orchestrator)">
  <div class="shell grid">
    <div class="hero-inner">
      <div class="hero-meta reveal">
        <span class="chip chip--gold"><span class="dot" aria-hidden="true"></span><span data-presence-count>Live</span></span>
        <span class="chip">${person.location}</span>
        <span class="chip">${years} years on the Microsoft stack</span>
      </div>
      <h1>
        <span class="who reveal" data-i="1"><b>${person.name}</b> · ${person.role} at ${person.employer}</span>
        <span class="display">${splitLines('I design AI agents|that <em>do real work.</em>')}</span>
      </h1>
      <p class="lede reveal" data-i="3">I help organisations take agentic AI from pilot to governed production on the Microsoft stack: Copilot Studio, Microsoft Foundry, Microsoft 365 Copilot and the Power Platform.</p>
      <div class="hero-actions reveal" data-i="4">
        <button class="btn btn--primary" type="button" data-agent-open>${icon('spark')}<span>Ask my agent</span></button>
        <a class="btn" href="#agents">${icon('plug')}<span>Plug me into your Copilot</span></a>
        <button class="btn" type="button" data-xray-toggle aria-pressed="false">${icon('xray')}<span>X-ray this site</span></button>
      </div>
    </div>
    <div class="hero-foot">
      <ol class="bootlog" data-bootlog aria-label="System status">
        <li class="is-on">html ........... <b>ok</b> · interactive before any JavaScript</li>
        <li data-boot="gpu">gpu ............ <i>probing…</i></li>
        <li data-boot="swarm">swarm .......... <i>waiting</i></li>
        <li data-boot="edge">edge ........... <i>measuring…</i></li>
      </ol>
      <span class="scroll-cue">Scroll · the swarm follows</span>
    </div>
  </div>
</section>`;
}

function about(): Raw {
  const years = yearsOfExperience();
  return html`<section class="scene" id="about" data-scene="fields" data-place="right" data-xray="&lt;section#about&gt; · scene: fields (procedural)">
  <div class="shell grid">
    <div class="col-copy">
      ${sectionHead('01', 'About', 'From strategy|to <em>production.</em>')}
      <div class="prose reveal" data-i="3">
        <p>I'm an AI Architect in Avanade's Data &amp; AI practice in London, focused on agentic AI across Copilot Studio, Microsoft Foundry and Microsoft 365 Copilot.</p>
        <p>My foundation is ${years} years of Dynamics 365 and Power Platform delivery: first at a Microsoft partner in Galway, then leading solution architecture for a global aviation business. That grounding in data, process and ALM shapes how I approach AI: understand the operating model first, then design the agent that fits it.</p>
      </div>
      <ol class="roots-steps" role="list">
        <li class="reveal" data-i="1"><span class="when">Principle 1</span><div><strong>Architecture before agents</strong><span>Start with the process, the data and the guardrails. The agent is the last mile, not the first.</span></div></li>
        <li class="reveal" data-i="2"><span class="when">Principle 2</span><div><strong>Production is the job</strong><span>Pilots are cheap. ALM, approvals, telemetry and responsible AI are designed in from day one.</span></div></li>
        <li class="reveal" data-i="3"><span class="when">Principle 3</span><div><strong>If it repeats, build the tool</strong><span>Accelerators, templates, MCP servers and training, so the next team starts further ahead.</span></div></li>
      </ol>
      <p class="muted small reveal" data-i="4">Outside work, I play banjo with <a href="${music.bandUrl}" rel="noopener">${music.band}</a>, ${music.blurb}</p>
    </div>
  </div>
</section>`;
}

function capabilitiesSection(): Raw {
  return html`<section class="scene" id="capabilities" data-scene="graph" data-place="right-wide" data-xray="&lt;section#capabilities&gt; · scene: agent graph">
  <div class="shell">
    <div class="grid"><div class="col-copy">${sectionHead('02', 'What I do', 'Agentic AI,|<em>end to end.</em>', 'From the reference architecture to the last Power Automate flow: strategy, design, governance and delivery on the Microsoft stack.')}</div></div>
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
    <div class="grid"><div class="col-copy">${sectionHead('03', 'Projects', 'Open-source|<em>tooling.</em>', 'Tools and experiments for people building with agents, mostly about connecting them to real systems. Most are built agent-first: AI coding agents write much of the code, while I own the architecture, the review and the release.')}</div></div>
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
      ${sectionHead('04', 'Experience', 'Galway to|<em>London.</em>')}
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
    <div class="grid"><div class="col-copy">${sectionHead('05', 'Credentials', 'Certified,|<em>verifiably.</em>', 'Each certification links to Microsoft Learn for independent verification.')}</div></div>
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
    <div class="grid"><div class="col-copy">${sectionHead('06', 'Writing', 'Notes from|<em>the field.</em>', 'Practical guidance on Copilot Studio and agent design, written for the people building them.')}</div></div>
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
    <div class="grid"><div class="col-copy">${sectionHead('07', 'For agents', 'Plug me into|<em>your Copilot.</em>', 'This site speaks the Model Context Protocol. Add it to Copilot Studio, Microsoft 365 Copilot, VS Code, Claude or ChatGPT, and your own agent can answer questions about my experience, grounded in this profile.')}</div></div>
    <div class="agents-grid">
      <article class="card reveal" data-xray="MCP server · read-only · no auth · rate-limited">
        <span class="eyebrow">Remote MCP server</span>
        <h3>One URL, seven read-only tools</h3>
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
        <h3>Prefer a shell?</h3>
        <pre class="code" tabindex="0"><span class="c"># a CV that renders in your terminal</span>
<span class="k">curl</span> <span class="s">liamogrady.dev</span>

<span class="c"># the whole profile as Markdown, for your LLM</span>
<span class="k">curl</span> <span class="s">liamogrady.dev/llms-full.txt</span></pre>
        <p class="muted">There is also an <a href="/llms.txt">llms.txt</a>, schema.org JSON-LD, and WebMCP tools registered in this page for browser agents.</p>
      </article>
      <article class="card wide reveal" data-i="2">
        <span class="eyebrow">Guardrails</span>
        <div class="row">
          <span class="chip chip--cyan">${icon('shield')} public facts only</span>
          <span class="chip chip--cyan">read-only tools</span>
          <span class="chip chip--cyan">no client names, ever</span>
          <span class="chip chip--cyan">rate-limited at the edge</span>
          <span class="chip chip--cyan">no cookies, no tracking</span>
        </div>
        <p class="muted">The same rules apply to the agent on this page. Ask it anything; it only knows what is published here, and it says so when it doesn't know. <a href="/agents">Full details for developers</a>.</p>
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
        ${sectionHead('08', 'Contact', 'Start a|<em>conversation.</em>', 'For speaking and community sessions, collaboration on open-source agent tooling, or a conversation about agentic AI on the Microsoft stack. The full CV is available on request.')}
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
      description: `${person.oneLiner} Ask the on-site agent, connect the MCP server to your own Copilot, or browse recent work.`,
    },
    body,
  );
}
