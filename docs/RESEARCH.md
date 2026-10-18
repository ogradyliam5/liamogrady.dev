# Research: what "the most impressive website" means in October 2026

Two research tracks ran before any design: a creative survey of award-winning and viral sites (about 130 sources, 15 key claims re-verified on primary sources) and a technical survey of what browsers and Cloudflare can actually do today. This is the synthesis that drove the design.

## 1. The current bar

| Site | Recognition | What makes it impressive | Weakness |
|---|---|---|---|
| Lando Norris (OFF+BRAND, built on Webflow) | Awwwards Site of the Year 2025 and Users' Choice | Cinematic 3D, motion craft, a personality-led story | Heavy; built by a specialist studio team |
| Igloo Inc (Abeto) | Awwwards Site of the Year 2024 | Real-time WebGL ice and particle worlds | Long load, little content |
| Bruno Simon's portfolio (rebuilt with WebGPU/TSL) | FWA of the Year 2025 and People's Choice; Webby 2026 Technical Achievement | A playable 3D world: the portfolio is a game | Hard to scan quickly for a recruiter |
| Active Theory V6 | CSS Design Awards Website of the Year 2024 | New rendering techniques plus **AI chat and multiplayer** | Studio site, not a person |
| Kent C. Dodds | Developer community | A personal site with its own **MCP server** at kentcdodds.com/mcp | No visual ambition |
| Iain Tait, "Career Archive & Agent" | FWA Wire, Aug 2026 | A career archive exposed to agents over MCP | Narrow audience |

Sources: [Awwwards Sites of the Year](https://www.awwwards.com/websites/sites_of_the_year/), [CSSDA WOTY 2024: Active Theory V6](https://www.cssdesignawards.com/woty2024/sites/active-theory-v6), [Webby 2026: Bruno's Portfolio](https://winners.webbyawards.com/2026/websites-and-mobile-sites/features-design/technical-achievement/370083/brunos-portfolio), [Kent C. Dodds: About KCD MCP](https://kentcdodds.com/about-mcp), [FWA Wire](https://thefwa.net/?page=2).

**Reading of the field.** The very best sites now combine three things: GPU-rendered visuals (WebGL, increasingly WebGPU), some intelligence (AI chat), and other people (multiplayer presence). Separately, a small group of developers have started making their sites *agent-native* (MCP servers, llms.txt). Nobody has put all of it together, with real engineering discipline, in a personal site. And almost none of the award winners is fast, accessible and useful to someone in a hurry.

## 2. What "10x" means for Liam

Liam is an AI architect, so the site should not just *describe* agentic AI: it should *be* a small, well-governed agentic system that visitors can see working.

1. **A hand-written GPU engine, not a library.** Up to 1,048,576 particles on WebGPU compute (262,144 on the WebGL2 fallback), forming procedural scenes tied to his story: the orchestrator, Galway's dry-stone walls, the Galway → London flight path, his credentials, a banjo. Zero 3D assets, zero dependencies.
2. **An agent that operates the page.** Ask a question and it navigates, highlights the project it's talking about, changes the formation, opens X-ray. Every tool call is shown (Liam has built Copilot Studio front-ends with visible reasoning chains; this is the same idea).
3. **Two genuinely useful skills:** *fit check* (paste a job spec, get an honest requirement-by-requirement match with gaps) and *architecture sketch* (describe a problem, get a first-pass Microsoft-stack design the way Liam would open discovery). Gartner's 2026 buyer survey found that 67% of B2B buyers prefer a rep-free experience, so self-serve matters.
4. **Agent-native by default:** a public MCP server (one-click install for VS Code and Cursor, instructions for Copilot Studio, Microsoft 365 Copilot, Claude and ChatGPT), WebMCP tools in the page, llms.txt, JSON-LD and a `curl`-able terminal CV. "Plug me into your Copilot" is a show-off that is exactly his day job.
5. **Other people:** live presence over a Durable Object, so you can see who else is reading.
6. **Glass box:** press X to see the architecture live: the GPU backend and frame rate, the edge location serving you, Server-Timing, Core Web Vitals, bundle sizes, the agent's model, latency and tokens, and packets moving through a live diagram.
7. **Engineering discipline award sites skip:** HTML-first content that works with no JavaScript, a strict CSP with hashes, reduced-motion still frames, keyboard access everywhere, a small JavaScript budget, and graceful fallbacks (no WebGPU → WebGL2 → CSS poster; no model budget → deterministic retrieval).

## 3. Things deliberately avoided (2026 clichés)

- Custom cursors that replace the system cursor, scroll-jacking, and long preloaders. The "boot log" here is real status, shown in place, never blocking.
- Generic "AI chatbot in a bubble". The agent is a first-class part of the interface with visible tools and guardrails.
- Stock 3D models and HDRIs. Every formation is generated from code.
- Overselling llms.txt: an Ahrefs study of 137,000 sites found almost no traffic to these files, so it is a cheap extra rather than a feature ([Ahrefs](https://ahrefs.com/blog/llmstxt-study/)).

## 4. Technical findings that shaped the build

- **Hosting:** Cloudflare Workers with static assets, not Pages (Pages lacks Durable Objects, Rate Limiting and Workers Logs). A custom domain on Workers needs Cloudflare nameservers, so DNS moves from GoDaddy first.
- **Free plan:** 100,000 Worker requests a day and 10 ms CPU per request (network waits are free); Workers AI is capped at 10,000 neurons a day, roughly 300 tool-calling turns on `@cf/zai-org/glm-4.7-flash`. Workers Paid ($5/month) is recommended before promoting the agent.
- **WebGPU** reaches about 88% of users (Chrome, Edge, Safari 26+, Firefox on Windows and Apple Silicon). The rest get WebGL2 GPGPU, and anything older gets a CSS poster.
- **MCP** moved to the stateless 2026-07-28 specification; the server uses the Agents SDK `createMcpHandler` with legacy support so 2025-era clients still connect.
- **WebMCP** is in a Chrome origin trial (`document.modelContext.registerTool`); the page feature-detects it.
- **Email:** Cloudflare Email Routing would replace liamogrady.dev's Microsoft 365 MX records, so the contact form delivers through Microsoft Graph or a Power Automate webhook instead.
- **Lighthouse:** lab runs usually have no GPU, so they score the poster path. The H1 is the LCP element and the engine loads after it.

## 5. Open questions for Liam

- Instruments: the band's channel lists vocals and banjo; an earlier note said fiddle and whistle. The site currently says "I sing and play banjo".
- Which private projects (if any) may be shown publicly.
- Whether to make the repository public (good for the "show-off" angle).
