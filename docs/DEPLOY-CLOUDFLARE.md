# Going live on Cloudflare

This takes about 30 minutes of clicking plus DNS propagation. Nothing here touches The Kings of Connaught's Cloudflare account. **Never deploy this site using the `wrangler` login already on your PC** (it belongs to the band account); use one of the two methods in step 4.

## 0. What exists today (audited 10 Oct 2026)

liamogrady.dev is registered at **GoDaddy** (nameservers `ns21/ns22.domaincontrol.com`). The website is on **Vercel** (A `216.198.79.193`, `www` CNAME to the apex). The domain also runs your **Microsoft 365 mail and device management**. These records must survive the move:

| Type | Name | Value | Proxy |
|---|---|---|---|
| MX | `@` | `liamogrady-dev.mail.protection.outlook.com` (priority 0) | n/a |
| TXT | `@` | `v=spf1 include:spf.protection.outlook.com -all` | n/a |
| TXT | `@` | `v=verifydomain MS=5807742` | n/a |
| CNAME | `autodiscover` | `autodiscover.outlook.com` | **DNS only** |
| CNAME | `enterpriseregistration` | `enterpriseregistration.windows.net` | **DNS only** |
| CNAME | `enterpriseenrollment` | `enterpriseenrollment-s.manage.microsoft.com` | **DNS only** |

There are no DKIM (`selector1/2._domainkey`) or DMARC records today. Adding them is worth doing while you're in there (Microsoft Defender portal → Email authentication → DKIM; and a `_dmarc` TXT such as `v=DMARC1; p=quarantine; rua=mailto:liam@liamogrady.dev`).

> Do **not** enable Cloudflare Email Routing on liamogrady.dev: it replaces the MX record and would cut off your Microsoft 365 mailbox. The contact form uses Microsoft Graph or a webhook instead (see `docs/WORKER.md`).

## 1. Create the account

1. Sign up at dash.cloudflare.com with a personal email (not the band's).
2. The Workers Free plan is fine: 100,000 requests a day, and the agent's model runs on OpenAI, not Workers AI. Move to **Workers Paid ($5/month)** only if traffic outgrows that.

## 2. Add the domain

1. **Add a domain** → `liamogrady.dev` → Free plan → let Cloudflare scan the existing records.
2. Compare the imported records with the table above. Add anything missing. Set every CNAME in the table to **DNS only** (grey cloud).
3. **Delete** the Vercel records: the apex `A 216.198.79.193` and the `www` CNAME. The Worker creates its own records in step 5.
4. Cloudflare shows two nameservers, e.g. `ada.ns.cloudflare.com` and `bob.ns.cloudflare.com`.

## 3. Switch nameservers at GoDaddy

1. GoDaddy → Domain → **DNSSEC**: turn it off if it's on (otherwise resolution breaks during the switch).
2. GoDaddy → Domain → **Nameservers** → "I'll use my own" → enter the two Cloudflare nameservers.
3. Wait for Cloudflare to email "liamogrady.dev is now active" (minutes to a few hours). Your mail keeps working throughout because the MX record is identical.
4. Later, turn DNSSEC back on from Cloudflare (DNS → Settings) and add the DS record it gives you at GoDaddy.

## Branches, sites and deploys

| Branch | Site | Worker | Address |
|---|---|---|---|
| `dev` | Dev site, marked "[dev]" in the tab and kept out of search engines | `liamogrady-dev-dev` | `https://liamogrady-dev-dev.liamogrady.workers.dev`, then `https://dev.liamogrady.dev` |
| `main` | Live site | `liamogrady-dev` | `https://liamogrady-dev.liamogrady.workers.dev`, then `https://liamogrady.dev` |

Every push to `dev` or `main` runs `.github/workflows/deploy.yml`: type-check, unit tests, build, deploy. A failing
check stops the deploy, so the site stays on the last good version. Work on `dev`, check the dev site, then merge
`dev` into `main` to go live. The workflow uses two repository secrets, `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`. Worker secrets (`OPENAI_API_KEY`) are set once per Worker and survive every deploy:

```powershell
node scripts/wrangler-safe.mjs secret put OPENAI_API_KEY             # live
node scripts/wrangler-safe.mjs secret put OPENAI_API_KEY --env dev   # dev
```

The dev Worker has its own presence room, rate limits and a smaller daily token cap (500,000).

## 4. Deploy the Worker by hand (only if the workflow is unavailable)

### A. Recommended: from GitHub with Workers Builds (no credentials on any PC)

1. Push this repository to GitHub (e.g. `ogradyliam5/liamogrady.dev`, public or private).
2. Cloudflare → **Workers & Pages → Create → Import a repository** → pick the repo.
3. Build command: `npm ci && npm run build`. Deploy command: `npx wrangler deploy`. Root: `/`.
4. Every push to `main` deploys; pull requests get preview URLs.

### B. From your PC with a scoped API token

1. Cloudflare → My Profile → **API Tokens → Create token → "Edit Cloudflare Workers"** template, scoped to **your new account only**.
2. In a fresh PowerShell window (the token lives only in that window):
   ```powershell
   cd $env:USERPROFILE\claw-workspace\liamogrady-dev-final   # or wherever you unzipped the repo
   $env:CLOUDFLARE_ACCOUNT_ID = '<your new account id>'
   $env:CLOUDFLARE_API_TOKEN  = '<the token>'
   $env:LOD_DEPLOY = '1'
   npm run deploy
   ```
   `scripts/wrangler-safe.mjs` refuses to deploy unless all three are set, so the band's stored login can never be used by accident.

The first deploy publishes to `https://liamogrady-dev.<your-subdomain>.workers.dev`. Check it there before attaching the domain.

## 5. Attach the domain

1. In `wrangler.jsonc`, uncomment the `routes` block (`liamogrady.dev` and `www.liamogrady.dev` with `custom_domain: true`) and deploy again; or add both under the Worker's **Settings → Domains & Routes**.
2. Add a **Redirect Rule**: `www.liamogrady.dev/*` → `https://liamogrady.dev/${1}` (301).
3. Remove the domain from the old Vercel project. Keep the Vercel deployment for a week as a rollback.

## 6a. Connect the agent to OpenAI

1. platform.openai.com → **Projects** → create a project (for example `liamogrady-dev`) and set a **monthly budget** on it.
2. In that project, **API keys → Create new secret key**. Use a key for this site only, so you can revoke it without affecting anything else.
3. Cloudflare → Workers & Pages → `liamogrady-dev` → **Settings → Variables and Secrets → Add** → type **Secret**, name `OPENAI_API_KEY`, paste the key → Deploy.
   (Or, with the step 4B variables set: `node scripts/wrangler-safe.mjs secret put OPENAI_API_KEY`.)
4. Open the site, press `/` and ask a question. The chip at the top of the agent panel should read **GPT-6 Luna**, not "offline mode".

The model and the daily cap are plain variables in `wrangler.jsonc`: `OPENAI_MODEL` (default `gpt-6-luna`) and `AGENT_DAILY_TOKENS` (default 3,000,000 tokens a day, at most about $1.50). Never paste the key into the repo, `.dev.vars.example` or a chat.

## 6. Turn on the extras

| Feature | What to do |
|---|---|
| Agent | Add your OpenAI key (step 6a). Until then the agent answers from the profile index. Optional: create an **AI Gateway** and set `OPENAI_BASE_URL` to its OpenAI endpoint for caching and analytics. |
| Bot protection | Cloudflare → **Turnstile** → add widget for `liamogrady.dev` → put the site key in `TURNSTILE_SITE_KEY`, and add the secret key as `TURNSTILE_SECRET` (Worker → **Settings → Variables and Secrets** in the dashboard, or `node scripts/wrangler-safe.mjs secret put TURNSTILE_SECRET` with the step 4B variables set; never plain `npx wrangler`). |
| Contact form | Choose `CONTACT_DELIVERY` = `graph` (Microsoft Graph sendMail from your own tenant) or `webhook` (Power Automate / Logic Apps HTTP trigger). Set-up steps are in `docs/WORKER.md`. Until then the form falls back to opening the visitor's email app. |
| Analytics | Cloudflare **Web Analytics** (privacy-first, no cookies). |
| WebMCP | Register for the Chrome WebMCP origin trial for `liamogrady.dev`, then build with the token in `WEBMCP_ORIGIN_TRIAL` (Workers Builds → Settings → Build variables). The build adds the origin-trial meta tag to every page. |
| MCP Registry | Optional: publish `server.json` as `dev.liamogrady/profile` (needs a DNS TXT record for verification). |

## 7. Smoke test after go-live

```bash
curl https://liamogrady.dev                      # ANSI CV
curl -s https://liamogrady.dev/api/edge          # colo + timings
npx @modelcontextprotocol/inspector --cli https://liamogrady.dev/mcp --transport http --method tools/list
```

Then send yourself an email at liam@liamogrady.dev to confirm Microsoft 365 mail still flows, open the site on your phone, and press **X** on a desktop to check the X-ray readings.
