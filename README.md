# liamogrady.dev

[![CI](https://github.com/ogradyliam5/liamogrady.dev/actions/workflows/ci.yml/badge.svg)](https://github.com/ogradyliam5/liamogrady.dev/actions/workflows/ci.yml)

**Live: [liamogrady.dev](https://liamogrady.dev)** · Try `curl liamogrady.dev` in a terminal.

This is the source code of my personal website. I'm Liam O'Grady, an AI Architect at Avanade working on agentic AI on the Microsoft stack (Copilot Studio, Microsoft Foundry, Microsoft 365 Copilot and Power Platform). I built the site as a small production system, the way I'd design one for a client: clear boundaries, guardrails, graceful fallbacks and things you can observe.

## What's on the site

| Feature | What it does |
|---|---|
| **The swarm** | A hand-written GPU particle engine (up to 1,048,576 particles) that flows between shapes: the orchestrator, Galway's dry-stone walls, the Galway → London flight path, my credentials and a banjo. WebGPU compute shaders, falling back to WebGL2, then to a pure-CSS poster. No three.js, no models, no textures. |
| **An agent that drives the page** | Ask a question and it searches my profile, scrolls the page, highlights sections and changes the swarm shape, showing each tool call. It also has a *fit check* (paste a job spec, get a scored card) and an *architecture sketch* (describe a business problem). |
| **Agent-native** | A public, read-only [MCP](https://modelcontextprotocol.io) server at `/mcp`, WebMCP tools in the page, `llms.txt`, JSON-LD and a plain-text CV for terminals. |
| **Live presence** | See other visitors as particles, over WebSockets and a Durable Object. |
| **X-ray mode** | Press `X` to see the system's live telemetry: edge location, timings and what the agent is doing. |
| **Zero front-end dependencies** | HTML first, strict CSP, accessible and respects reduced motion. The site is complete with JavaScript switched off. |

## How it works

```
                        ┌──────────────── Cloudflare ────────────────┐
Browser  ── HTTPS ───►  │ Worker (src/worker)                        │
 static HTML + tiny JS  │  ├─ static assets from dist/ (no Worker)   │
 swarm, agent panel     │  ├─ /            terminal CV for curl      │
                        │  ├─ /api/agent   SSE ──► OpenAI Responses  │
curl ── GET / ───────►  │  ├─ /api/live    WebSocket ► Presence DO   │
                        │  ├─ /api/contact contact / CV request      │
MCP clients ── /mcp ──► │  └─ /mcp         read-only MCP server      │
 (Copilot, Claude,      │  Durable Objects: Presence, Budget         │
  VS Code, ChatGPT)     │  Rate limits per IP · Workers Logs         │
                        └────────────────────────────────────────────┘
```

### One source of truth

Everything the site says about me lives in [`content/profile.ts`](content/profile.ts). The build turns it into the HTML pages, the agent's knowledge, the MCP server's tools, `llms.txt`, the JSON-LD and the terminal CV. Edit one file and all of them update. Only public-safe facts go in there, so there is nothing confidential for the agent or MCP server to leak.

### Build (`scripts/build.ts`)

Bun renders every page to static HTML at build time, bundles the browser code, inlines the CSS and computes SHA-256 hashes for every inline script and style so the Content Security Policy needs no `unsafe-inline`. Output goes to `dist/`. CI fails the build if total JavaScript passes 80 KB gzipped.

### Browser

The initial entry script is only a few KB and just wires up events. The swarm engine loads after the page is idle, and the agent panel, X-ray, audio and presence load on demand. The engine keeps particle state on the GPU, moves particles to hashed targets in the current formation with spring forces, flow noise and pointer interaction, and then renders with HDR bloom. It measures frame time and adapts the particle count, so it looks the same on a phone or a desktop GPU.

### The Worker (`src/worker`)

One Cloudflare Worker sits in front of `dist/`. Static files are served straight from the asset store. Only these paths run the Worker first:

| Path | Purpose |
|---|---|
| `/` | Terminal clients (curl, wget, PowerShell) get a coloured plain-text CV. Browsers get the HTML page. |
| `/api/agent` | The on-site agent, streamed as Server-Sent Events. |
| `/api/live` | WebSocket presence (a hibernating Durable Object). |
| `/api/contact` | Contact and CV-request form (honeypot, optional Turnstile). |
| `/api/edge` | Which Cloudflare location served you, and timings. |
| `/mcp` | Public read-only MCP server. |

### The agent

- The browser posts the conversation to `/api/agent`. The Worker calls the OpenAI **Responses API** (GPT-6 Luna). The key lives only in a Worker secret and the browser never sees it.
- The model can call **data tools** that run on the server (search the profile with BM25, fetch a section, assess role fit, sketch an architecture) and **UI tools** that the browser runs (navigate, highlight, change the formation, open X-ray). Every call is streamed to the page.
- Fit checks and architecture sketches return JSON that is validated against a schema and shown as cards.
- **Guardrails:** it only knows public content, refuses questions about clients, metrics and its own prompt, treats pasted text as data, caps input size, rate-limits each IP (8 a minute) and has a **daily token budget** tracked in a Durable Object.
- **Degrades gracefully:** if the budget is spent, the model is down or the API is unreachable, a deterministic retrieval agent answers in the same event format, so the agent never just fails.

### The MCP server

`/mcp` speaks Streamable HTTP and is read-only, rate-limited (60 a minute per IP) and validates the `Origin` header. It exposes the tools `get_profile`, `get_experience`, `list_projects`, `get_certifications`, `search_profile`, `assess_role_fit` and `get_contact_options`, plus the resources `profile-markdown` and `profile-json` and the prompts `introduce_liam` and `assess_fit`. Add `https://liamogrady.dev/mcp` as a server in any MCP client to ask about me.

### Security

A strict hashed CSP, `frame-ancestors 'none'`, a locked-down Permissions-Policy and COOP, no cookies and no third-party trackers. Secrets only exist in Cloudflare and GitHub Actions secret stores. See [Security and secrets](#security-and-secrets).

## Deployment

Two branches, two sites, both deployed by GitHub Actions to Cloudflare Workers:

| Branch | Site | Address |
|---|---|---|
| `main` | Live | https://liamogrady.dev |
| `dev` | Dev (shows `[dev]` in the tab, hidden from search engines) | https://dev.liamogrady.dev |

Every push to `dev` or `main` runs the type check, the tests and the build, checks the bundle size, deploys, and then checks that the deployed commit is the one being served. If any step fails, the site stays on its last working version. The dev site has its own presence room, token budget and secrets. DNS for `liamogrady.dev` is on Cloudflare, with the Microsoft 365 mail records set to DNS-only.

## Run it locally

You need Node 24 and [Bun](https://bun.sh).

```bash
npm install
cp .dev.vars.example .dev.vars   # local, non-secret settings (uses the offline mock agent)
npm run dev                      # build + local Worker
npm test                         # unit tests
npm run typecheck
npm run build                    # static build into dist/
```

`npm run dev` and `npm run deploy` go through `scripts/wrangler-safe.mjs`, which never uses a stored `wrangler` login and refuses to deploy unless the Cloudflare account is set explicitly. See [`docs/DEPLOY-CLOUDFLARE.md`](docs/DEPLOY-CLOUDFLARE.md).

## Project layout

```
content/profile.ts        everything the site says about me (public-safe only)
src/shared/knowledge.ts   chunks + BM25 search + Markdown, shared by site, agent and MCP
src/site/                 build-time HTML: layout, pages, CSS, icons, llms.txt
src/client/               browser code: entry, scene controller, UI modules
src/client/engine/        particle engine (WebGPU + WebGL2 backends, shaders, formations)
src/worker/               Worker: router, agent, MCP server, presence and budget Durable Objects
scripts/build.ts          static build, bundling and CSP hashing
tests/                    unit tests
docs/                     architecture, Worker contracts, deployment, research
```

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): design principles, the engine, the agent, security and performance budgets
- [`docs/WORKER.md`](docs/WORKER.md): endpoints, the SSE event contract, configuration and secrets
- [`docs/DEPLOY-CLOUDFLARE.md`](docs/DEPLOY-CLOUDFLARE.md): Cloudflare setup, DNS and deploys
- [`docs/RESEARCH.md`](docs/RESEARCH.md): what the best personal sites do today and how this one goes further

## Editing content

Edit `content/profile.ts` only. **Confidentiality rule:** no client names, client project names, user counts, money or internal integrations. Projects only appear when `publish: true`.

## Security and secrets

No secrets are in this repository. API keys (OpenAI, Turnstile, Microsoft Graph) live only in Cloudflare Worker secrets and GitHub Actions secrets. `.dev.vars.example` lists the variable names for local development. Found something? Please open an issue without sensitive details, or contact me through the site.

## Licence

The code is shared for reference. The content in `content/profile.ts`, including the copy and photos, is © Liam O'Grady, all rights reserved. Fonts keep their own licences (see `public/fonts/licenses`).
