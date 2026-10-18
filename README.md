# liamogrady.dev

[![CI](https://github.com/ogradyliam5/liamogrady.dev/actions/workflows/ci.yml/badge.svg)](https://github.com/ogradyliam5/liamogrady.dev/actions/workflows/ci.yml)

**Live:** https://liamogrady.dev

The personal site of **Liam O'Grady**, AI Architect at Avanade, built as a small production system:

- **The swarm:** a hand-written GPU particle engine (WGSL compute on WebGPU, GLSL ES 3.0 GPGPU on WebGL2) with up to 1,048,576 particles that flow between procedural formations: the orchestrator, Galway's dry-stone walls, the Galway → London flight path, his credentials, a banjo. No three.js, no models, no textures.
- **An agent that drives the page:** ask a question and it searches the profile, navigates, highlights, changes the formation and shows every tool call. Two skills: *fit check* for a pasted job spec and *architecture sketch* for a business problem. It runs on OpenAI GPT-6 Luna through the Responses API, called only from the Worker, with a daily token budget and a deterministic fallback.
- **Agent-native:** a public read-only MCP server at `/mcp`, WebMCP tools in the page, `llms.txt`, JSON-LD, and `curl liamogrady.dev` for a terminal CV.
- **Live presence** of other visitors over a Durable Object, and **X-ray mode** (press `X`) showing the system's live telemetry.
- **Zero front-end dependencies.** HTML-first, strict CSP, accessible, reduced-motion aware.

## Layout

```
content/profile.ts        everything the site says about Liam (public-safe only)
src/shared/knowledge.ts   chunks + BM25 search + Markdown, shared by site, agent and MCP
src/site/                 build-time HTML: layout, pages, CSS, icons, llms.txt etc.
src/client/               browser code: entry, scene controller, formations, UI modules
src/client/engine/        the particle engine (WebGPU + WebGL2 backends, shaders, formations)
src/worker/               Cloudflare Worker: router, agent, MCP server, presence DO, contact
scripts/build.ts          static build (Bun): bundles, inlines CSS, renders pages, CSP hashes
scripts/shoot.mjs         Playwright screenshot harness used during development
docs/                     research, architecture, deployment, worker contracts
```

## Commands

```bash
npm install            # wrangler, typescript, vitest, bun (dev only)
npm run build          # → dist/
npm run dev            # build + wrangler dev (safe wrapper, local only)
npm test               # worker unit tests
npm run typecheck
```

Deploys are automatic: push to `dev` to update the dev site, push to `main` to update liamogrady.dev (see `docs/DEPLOY-CLOUDFLARE.md`, "Branches, sites and deploys").

`npm run dev` and `npm run deploy` go through `scripts/wrangler-safe.mjs`, which never uses a stored wrangler login. See `docs/DEPLOY-CLOUDFLARE.md` before deploying.

## Editing content

Edit `content/profile.ts`. It feeds every page, the agent's knowledge, the MCP server, `llms.txt` and the terminal CV, so a change there updates all of them on the next build.

**Confidentiality rule:** no client names, project names delivered for clients, user counts, money or internal integrations. Projects only appear when `publish: true`.

## Docs

- `docs/RESEARCH.md`: what the most impressive sites do today and how this one goes further
- `docs/DEPLOY-CLOUDFLARE.md`: new Cloudflare account, DNS move from GoDaddy (keeping Microsoft 365 mail), deploy, custom domain
- `docs/WORKER.md`: endpoints, SSE event contract, configuration and secrets

## Security and secrets

No secrets are in this repository. API keys (OpenAI, Turnstile, Graph) live only in Cloudflare Worker secrets and GitHub Actions secrets; `.dev.vars.example` lists the names for local development. The Worker enforces a strict CSP, per-IP rate limits and a daily token budget on the agent.

## Licence

The code is shared for reference. Site content in `content/profile.ts` and the photos and copy are © Liam O'Grady, all rights reserved. Fonts keep their own licences (see `public/fonts/licenses`).
