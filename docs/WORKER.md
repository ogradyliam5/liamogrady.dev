# The Worker: endpoints, contracts and configuration

One Cloudflare Worker (`src/worker/index.ts`) sits in front of the static build in `dist/`.
Static files are served straight from the asset store at no Worker cost. Only these paths run
the Worker first (`assets.run_worker_first` in `wrangler.jsonc`):

| Path | Method | What it does |
|---|---|---|
| `/` | GET, HEAD | Terminal clients (curl, wget, HTTPie, xh, PowerShell) get a plain-text CV with ANSI colour (`?plain` or `?color=0` turns it off). Browsers get `dist/index.html`. The response varies on `User-Agent`. |
| `/api/agent` | POST | The on-site agent. Streams Server-Sent Events (contract below). |
| `/api/live` | GET (WebSocket) | Live presence: joins the `lobby` Durable Object. |
| `/api/contact` | POST | Contact and CV-request form. |
| `/api/edge` | GET | Where and how this request was served (Cloudflare colo, timing). Used by the boot log and X-ray mode. |
| `/mcp` | POST, GET, DELETE | Public, read-only MCP server (Streamable HTTP). A browser GET is redirected to `/agents`. |

Every Worker response carries a `Server-Timing` header with the Worker time and the Cloudflare colo, which X-ray mode displays.

## On-site agent: `POST /api/agent`

Request body:

```json
{ "messages": [{ "role": "user", "content": "What does Liam do?" }], "mode": "chat", "section": "work" }
```

- `mode`: `chat` (default), `fit` (paste a job spec, returns a fit card) or `architect` (describe a business problem, returns an architecture sketch).
- Limits: at most 12 messages, 4,000 characters per message, 12,000 user characters in total; the last message must come from the user.
- `turnstile`: optional token, required only when `AGENT_REQUIRE_TURNSTILE=1`.

The response is `text/event-stream`. Each event is one JSON object with a `type`:

| `type` | Payload | Purpose |
|---|---|---|
| `meta` | `requestId, provider, model, colo, mode, fallback` | First event. `fallback: true` means the model was unavailable and the deterministic agent answered. |
| `status` | `text` | Short progress line ("Searching the profile"). |
| `tool` | `id, name, args, kind` | A tool call. `kind: "data"` runs on the server (`search_profile`, ...); `kind: "ui"` is executed by the page. |
| `tool_result` | `id, name, ok, summary` | Result of a data tool. |
| `ui` | `action, args` | Drives the page: `navigate`, `highlight`, `scene` (change the swarm formation) or `open_xray`. |
| `card` | `kind, data` | Structured result: `fit`, `architecture` or `sources`. |
| `text` | `delta` | Streamed answer text (Markdown subset). |
| `done` | `usage, latencyMs, steps, model` | Final event on success. |
| `error` | `code, message` | `rate_limited`, `bad_request`, `upstream` or `budget`. |

The browser client (`src/client/ui/agent.ts`) also has an offline mode built from the same
profile (`src/shared/offline.ts`), used when the API is unreachable or not configured, so the
agent always answers.

### Providers

Set with `AGENT_PROVIDER`:

- `openai` (default): OpenAI through the **Responses API**, called only from the Worker. Needs the `OPENAI_API_KEY` secret; until it is set the agent answers from the deterministic profile index.
  - `OPENAI_MODEL` (default `gpt-6-luna`) for tool-calling chat, `OPENAI_MODEL_REASON` (default: the same) for the fit check and architecture sketch.
  - `OPENAI_REASONING_CHAT` (default `none`, fastest and cheapest) and `OPENAI_REASONING_ANALYSIS` (default `low`). Accepted values: `none`, `low`, `medium`, `high`, `xhigh`, `max`. Higher efforts get extra output room automatically, because reasoning tokens count towards `max_output_tokens`.
  - Requests are stateless (`store: false`); each step resends the turn, with tool calls as `function_call` / `function_call_output` items. Function tools are sent with `strict: false`.
  - `OPENAI_BASE_URL` is empty for `https://api.openai.com/v1`. Point it at a Cloudflare AI Gateway (`https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/openai`) for caching, logs and analytics.
- `workers-ai`: `AGENT_MODEL_CHAT` for tool calling (`@cf/zai-org/glm-4.7-flash`) and `AGENT_MODEL_REASON` for structured JSON analysis (`@cf/openai/gpt-oss-120b`). Optional `AI_GATEWAY_ID`.
- `openai-compatible`: Chat Completions for Azure OpenAI, Microsoft Foundry or any compatible gateway. Set `LLM_BASE_URL`, `LLM_MODEL`, optional `LLM_MODEL_REASON`, `LLM_AUTH_HEADER` (`api-key` for Azure, `authorization` for Bearer), optional `LLM_API_VERSION`, and the secret `LLM_API_KEY`.
- `mock`: deterministic, offline, used by local dev and the tests.
- `none`: the API answers with the deterministic fallback only.

### Daily token budget

`AGENT_DAILY_TOKENS` (default 3,000,000) caps the tokens the agent spends per UTC day across all
visitors. The count lives in one SQLite-backed Durable Object (`Budget`, instance `ledger`), so it
holds across every Cloudflare location. Before each model call the Worker checks what is left; after
it, the usage is recorded in the background. Once the day is spent, the agent switches to its
deterministic fallback and tells the visitor ("Today's AI budget is used up"). If the ledger cannot be
read, the guard fails closed. Set `"0"` to turn it off.

At GPT-6 Luna's list prices ($0.10 input / $0.50 output per million tokens), 3,000,000 tokens a day
costs at most $0.30 to $1.50, depending on the input/output mix. Set a monthly budget on the OpenAI
project as well; the two limits are independent.

The model can also fail or return output that does not validate. In every case the Worker switches
to its deterministic fallback (`meta` is re-sent with `fallback: true`) and says so in the answer.
A conversation that grows too long gets a `budget` error asking the visitor to start a new chat.

## MCP server: `/mcp`

Built with the official MCP TypeScript SDK through the Cloudflare Agents SDK handler
(`src/worker/mcp/`). Stateless, read-only, no authentication. Server name `liamogrady-dev`.

- Tools (all annotated read-only): `get_profile`, `get_experience`, `list_projects`, `get_certifications`, `search_profile`, `assess_role_fit`, `get_contact_options`.
- Resources: `liam://profile.md` (the whole profile as Markdown) and `liam://profile.json`.
- Prompts: `introduce_liam` and `assess_fit`.

Connect from VS Code, Copilot Studio, Claude or ChatGPT with the URL `https://liamogrady.dev/mcp`.
`server.json` describes the server for MCP registries. `node scripts/smoke-mcp.mjs [url]` checks a
running server end to end.

## Presence: `/api/live`

One SQLite-backed Durable Object (`Presence`, instance `lobby`) using hibernating WebSockets, so
idle connections cost nothing. Only a rough country is shared with other visitors, never an IP.

- Client → server: `{ "t": "m", "x", "y", "s" }` pointer position and section, `{ "t": "n", "n" }` a note played on the banjo reel, `{ "t": "p" }` ping.
- Limits: 48 active peers, 512-byte messages, 30 moves and 8 notes a second per peer.

## Contact: `POST /api/contact`

Body: `{ "kind": "hello" | "cv", "name", "email", "company"?, "message"?, "turnstile"? }`
(`message` is required for `hello`). A hidden honeypot field rejects bots.

Delivery adapter, set with `CONTACT_DELIVERY`:

- `graph`: Microsoft Graph `sendMail` from `GRAPH_SENDER` (for example hello@liamogrady.dev) to `CONTACT_TO`, with the visitor as Reply-To. Needs an Entra app registration with the `Mail.Send` application permission, scoped to that one mailbox (Exchange Online RBAC for Applications). Set `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_SENDER` and the secret `GRAPH_CLIENT_SECRET`.
- `webhook`: posts JSON to a Power Automate or Logic Apps HTTP trigger. Secret `CONTACT_WEBHOOK_URL`.
- `none` (default): answers `{ ok: false, error: "not_configured", mailto }` and the form opens the visitor's email client instead.

Do **not** turn on Cloudflare Email Routing for liamogrady.dev: it replaces the MX records and
would break Microsoft 365 mail.

## Rate limits

Workers Rate Limiting bindings, keyed on the visitor IP (on top of the daily token budget): `RL_AI` 8 a minute, `RL_MCP` 60 a minute,
`RL_CONTACT` 3 a minute. Each needs a `namespace_id` that is unique within the Cloudflare account.

## Configuration

Plain variables live in `wrangler.jsonc` under `vars`: `SITE_URL`, `AGENT_PROVIDER`,
`OPENAI_MODEL`, `OPENAI_MODEL_REASON`, `OPENAI_REASONING_CHAT`, `OPENAI_REASONING_ANALYSIS`,
`OPENAI_BASE_URL`, `AGENT_DAILY_TOKENS`, `AGENT_MODEL_CHAT`, `AGENT_MODEL_REASON`, `AI_GATEWAY_ID`,
`CONTACT_DELIVERY`, `CONTACT_TO`, `TURNSTILE_SITE_KEY`, `ALLOWED_HOSTS`.

Secrets are never committed. Set them on your own account with
`node scripts/wrangler-safe.mjs secret put NAME` (or in the dashboard: Worker → Settings →
Variables and Secrets): `OPENAI_API_KEY`, `TURNSTILE_SECRET`, `LLM_API_KEY`, `GRAPH_CLIENT_SECRET`,
`CONTACT_WEBHOOK_URL`.

## Account safety

The global `wrangler login` on Liam's PC belongs to the band's Cloudflare account. This repo never
calls wrangler directly: `scripts/wrangler-safe.mjs` is the only entry point.

- `dev` and `types` always run local-only with a dummy token and account id, so nothing can reach any Cloudflare account.
- `deploy` and `secret put` refuse to run unless `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `LOD_DEPLOY=1` are all set explicitly for the new account.
- `login`, `logout`, `whoami`, `tail`, KV, D1 and every other command are refused.

The recommended path is Workers Builds (connect the GitHub repo in the new account's dashboard),
which needs no token on the PC at all. See `docs/DEPLOY-CLOUDFLARE.md`.

## Local development and tests

```bash
cp .dev.vars.example .dev.vars   # AGENT_PROVIDER=mock, CONTACT_DELIVERY=none
npm run dev                      # build + wrangler dev (local only) on http://127.0.0.1:8787 (add -- --port 8899 if 8787 is taken)
npm test                         # unit tests (router, agent, OpenAI provider, budget, MCP, contact, presence, terminal CV)
npm run typecheck
```
