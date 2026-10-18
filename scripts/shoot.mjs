// Screenshot harness for the sandbox (Playwright from the docgen toolchain + bundled Chromium).
// Usage: node scripts/shoot.mjs --url /lab/engine.html?shape=orbits --out shots/x.png [--webgpu] [--wait 4000]
//        [--w 1440 --h 900] [--dpr 1] [--reduced] [--root dist|.] [--scroll 1200] [--eval "js"]
//        [--mock]       serve stand-ins for /api/agent (SSE), /api/edge, /api/contact and /api/live (WebSocket)
//        [--save-data]  report Save-Data, so the page skips the GPU swarm (fast shots on CPU-only sandboxes)
//        [--timeout 30000] screenshot timeout in ms
//        [--init "js"]  run before any page script (e.g. to stub a browser API)
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { join, extname, dirname, resolve } from 'node:path';

const require = createRequire('/usr/local/lib/node_modules/docgen-utils/');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const flag = (k) => args.includes('--' + k);
const root = resolve(opt('root', '.'));
const urls = opt('url', '/').split(',');
const outs = opt('out', 'shots/shot.png').split(',');
const wait = Number(opt('wait', '4000'));
const W = Number(opt('w', '1440'));
const H = Number(opt('h', '900'));
const dpr = Number(opt('dpr', '1'));
const scrolls = (opt('scroll', '') || '').split(',').filter(Boolean).map(Number);
const evalJs = opt('eval', '');
const fullPage = flag('full');
const shotTimeout = Number(opt('timeout', '30000'));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' };
const mock = flag('mock');

// ---------- --mock: stand-ins for the Worker's API so the client UI can be exercised offline ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODEL = 'gpt-6-luna';
const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((ok) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => ok(s));
  });

const FIT = {
  role: 'Lead AI Solutions Architect',
  company: 'Northwind Health',
  overall: 84,
  verdict: 'A strong fit for the agentic AI and Copilot Studio core of the role. The main gap is healthcare domain delivery, which the public profile does not show.',
  strengths: [
    'Architects Copilot Studio, Microsoft Foundry and Microsoft 365 Copilot solutions end to end',
    'Expert-level Microsoft certifications in agentic AI and Power Platform architecture',
    'Builds MCP servers and agent tooling hands-on, not just slideware',
  ],
  requirements: [
    { requirement: 'Design enterprise agentic AI on the Microsoft stack', match: 'strong', evidence: 'AI Architect at Avanade; previously led the AI and Copilot practice at DigPacks.', source: 'https://liamogrady.dev/#journey' },
    { requirement: 'Copilot Studio delivery across many teams', match: 'strong', evidence: 'Owned design and delivery of Copilot Studio agents across many concurrent engagements.', source: 'https://liamogrady.dev/#capabilities' },
    { requirement: 'Responsible AI and governance', match: 'strong', evidence: 'Governance models, Microsoft 365 Copilot readiness and CoE patterns.', source: 'https://liamogrady.dev/#capabilities' },
    { requirement: 'Azure OpenAI model customisation', match: 'partial', evidence: 'Foundry and Azure OpenAI appear in his architecture work; fine-tuning is not mentioned publicly.', source: 'capabilities' },
    { requirement: 'NHS or healthcare domain experience', match: 'gap', evidence: 'His final-year project analysed NHS Trust data, but no healthcare roles are listed.', source: 'https://liamogrady.dev/#journey' },
  ],
  gaps: ['No public healthcare delivery experience', 'Python-heavy ML engineering is not his focus'],
  questions: ['Which systems should the first agents act on?', 'Is the role hands-on with the build, or architecture and governance only?'],
};

const ARCH = {
  title: 'IT helpdesk agent for Microsoft 365',
  problem: 'Employees wait hours for password resets, access requests and "how do I" questions.',
  summary: 'A Copilot Studio agent in Teams answers from the knowledge base, resolves routine requests through ServiceNow and Power Automate, and hands off to a person with full context when it cannot.',
  layers: [
    { name: 'Channels', components: [{ name: 'Teams app', tech: 'Copilot Studio channel', purpose: 'Where employees already ask for help' }, { name: 'Intranet chat', tech: 'SharePoint embed', purpose: 'A second front door' }] },
    { name: 'Orchestration', components: [{ name: 'Helpdesk agent', tech: 'Copilot Studio, generative orchestration', purpose: 'Routes each intent to knowledge, a tool or a human' }, { name: 'Access agent', tech: 'Child agent', purpose: 'Group and licence requests' }] },
    { name: 'Knowledge', components: [{ name: 'IT knowledge base', tech: 'SharePoint + Azure AI Search', purpose: 'Grounded answers with citations' }, { name: 'Service catalogue', tech: 'ServiceNow KB', purpose: 'Request types and SLAs' }] },
    { name: 'Actions', components: [{ name: 'Ticketing tools', tech: 'ServiceNow MCP server', purpose: 'Create, update and query incidents' }, { name: 'Identity actions', tech: 'Power Automate + Microsoft Graph', purpose: 'Password resets and access changes with approval' }] },
    { name: 'Governance', components: [{ name: 'Guardrails', tech: 'Purview DLP, Managed Environments', purpose: 'Data loss prevention and environment strategy' }, { name: 'Telemetry', tech: 'Application Insights', purpose: 'Deflection, satisfaction and failure analysis' }] },
  ],
  flow: [
    'An employee asks in Teams',
    'The agent classifies the intent and checks the knowledge base first',
    'Routine requests run through ServiceNow or Power Automate tools, with approval for access changes',
    'Anything uncertain is handed to the service desk with a summary of the conversation',
  ],
  governance: ['Least-privilege connection per tool', 'A human approves every access change', 'Transcripts kept under the existing records policy'],
  phases: [
    { name: 'Pilot', weeks: 6, outcome: 'Knowledge answers and three request types for one department' },
    { name: 'Scale', weeks: 8, outcome: 'All request types, live hand-off to the service desk' },
    { name: 'Optimise', weeks: 4, outcome: 'Telemetry-driven tuning and new tools' },
  ],
  risks: ['Stale knowledge articles produce confident wrong answers', 'Over-broad connector permissions'],
};

const CHAT_TEXT =
  "Liam has shipped several **MCP servers**, all open source:\n\n" +
  '- **Claw PC for Copilot Cowork** gives Microsoft 365 Copilot a real Windows machine over a private dev tunnel.\n' +
  '- **Vercel MCP server** lets a Copilot Studio agent inspect deployments and read build logs, secured with an API key.\n' +
  '- **Hevy for ChatGPT** exposes OAuth-secured tools, with a preview and confirmation before every write.\n\n' +
  "They are zero-dependency and speak Streamable HTTP, the same transport as this site's own `/mcp` endpoint. I've highlighted Claw PC on the page; the code is on [GitHub](https://github.com/ogradyliam5).";

async function agentStream(req, res) {
  let body = {};
  try {
    body = JSON.parse((await readBody(req)) || '{}');
  } catch {}
  const mode = ['fit', 'architect'].includes(body.mode) ? body.mode : 'chat';
  const last = String(body.messages?.at(-1)?.content ?? '');
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
  const t0 = Date.now();
  // Events are deliberately written in uneven pieces, so the client's incremental parser has to cope.
  const send = async (o, split = false) => {
    const s = `data: ${JSON.stringify(o)}\n\n`;
    if (!split) return void res.write(s);
    const k = Math.max(1, Math.floor(s.length * 0.4));
    res.write(s.slice(0, k));
    await sleep(15);
    res.write(s.slice(k));
  };
  await send({ type: 'meta', requestId: `mock-${t0}`, provider: 'openai', model: MODEL, colo: 'LHR', mode, fallback: false });
  // "#error" in the question returns a rate-limit error event.
  if (/#error/i.test(last)) {
    await sleep(500);
    await send({ type: 'error', code: 'rate_limited', message: 'Too many requests from this address' });
    return res.end();
  }
  let text = '';
  let steps = 1;
  if (mode === 'chat') {
    await send({ type: 'status', text: 'Searching the public profile…' });
    await sleep(250);
    await send({ type: 'tool', id: 't1', name: 'search_profile', args: { query: 'MCP servers built' }, kind: 'data' }, true);
    await sleep(/#slow/i.test(last) ? 8000 : 420); // "#slow" holds the tool call open, to inspect the in-progress state
    await send({ type: 'tool_result', id: 't1', name: 'search_profile', ok: true, summary: '4 matches: Claw PC, Vercel MCP, Hevy, MCP capability' });
    await sleep(120);
    await send({ type: 'ui', action: 'navigate', args: { section: 'work' } });
    await sleep(160);
    await send({ type: 'ui', action: 'highlight', args: { target: 'project:claw-pc' } }, true);
    text = CHAT_TEXT;
    steps = 3;
  } else if (mode === 'fit') {
    await send({ type: 'status', text: 'Reading the job spec against the profile…' });
    await sleep(500);
    await send({ type: 'card', kind: 'fit', data: FIT }, true);
    text = 'An **84/100** match. The core of the role (agentic AI architecture on Copilot Studio and Foundry) is exactly what Liam does day to day; ask him about healthcare delivery, which the public profile does not cover.';
    steps = 2;
  } else {
    await sleep(400);
    await send({ type: 'card', kind: 'architecture', data: ARCH }, true);
    text = "Start with the pilot: knowledge answers plus three request types prove deflection quickly, and the approval step keeps identity changes safe. Liam has built this shape of agent before, so it's worth a conversation.";
    steps = 2;
  }
  const words = text.match(/\S+\s*/g) ?? [];
  const per = Math.max(1, Math.ceil(words.length / 28));
  for (let i = 0; i < words.length; i += per) {
    await send({ type: 'text', delta: words.slice(i, i + per).join('') }, i % 3 === 1);
    await sleep(36);
  }
  if (mode === 'chat') {
    await send({
      type: 'card',
      kind: 'sources',
      data: {
        items: [
          { title: 'Claw PC for Copilot Cowork', url: 'https://github.com/ogradyliam5/copilot-cowork-claw-pc' },
          { title: 'Vercel MCP server', url: 'https://github.com/ogradyliam5/vercel-mcp-copilot-studio' },
          { title: 'MCP servers & agent tooling', url: 'https://liamogrady.dev/#capabilities' },
        ],
      },
    });
  }
  await send({ type: 'done', usage: { inputTokens: 1834, outputTokens: Math.round(text.length / 4) }, latencyMs: Date.now() - t0, steps, model: MODEL });
  res.end();
}

/** Returns true when the request was handled by a mock route. */
async function mockApi(req, res) {
  const path = new URL(req.url, 'http://x').pathname;
  if (path === '/api/agent' && req.method === 'POST') {
    await agentStream(req, res);
    return true;
  }
  if (path === '/api/edge') {
    json(res, 200, { colo: 'LHR', city: 'London', country: 'GB', httpProtocol: 'HTTP/3', tlsVersion: 'TLSv1.3', rttMs: 12, ray: 'mock' }, { 'server-timing': 'edge;dur=0.4;desc="LHR", worker;dur=1.8' });
    return true;
  }
  if (path === '/api/contact' && req.method === 'POST') {
    await readBody(req);
    json(res, 200, { ok: false, error: 'not_configured', mailto: 'mailto:ogradyliam5@gmail.com' });
    return true;
  }
  return false;
}

/** A minimal WebSocket stand-in for /api/live: a welcome with three wandering peers. */
function mockLive(req, socket) {
  if (!req.url.startsWith('/api/live')) return socket.destroy();
  const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const send = (o) => {
    const data = Buffer.from(JSON.stringify(o));
    const head = data.length < 126 ? Buffer.from([0x81, data.length]) : Buffer.from([0x81, 126, data.length >> 8, data.length & 255]);
    if (!socket.destroyed) socket.write(Buffer.concat([head, data]));
  };
  const peers = [
    { id: 'p1', c: 'IE', x: 0.66, y: 0.34, s: 0 },
    { id: 'p2', c: 'US', x: 0.82, y: 0.62, s: 0 },
    { id: 'p3', c: 'DE', x: 0.42, y: 0.72, s: 3 },
  ];
  send({ t: 'welcome', id: 'me', here: peers.length + 1, peers });
  let tick = 0;
  const timer = setInterval(() => {
    tick++;
    for (const p of peers) {
      p.x = Math.min(0.95, Math.max(0.05, p.x + (Math.random() - 0.5) * 0.04));
      p.y = Math.min(0.92, Math.max(0.08, p.y + (Math.random() - 0.5) * 0.04));
      send({ t: 'm', ...p });
    }
    if (tick === 6) send({ t: 'join', id: 'p4', c: 'NL' });
    if (tick === 7) send({ t: 'm', id: 'p4', x: 0.58, y: 0.5, s: 0 });
  }, 400);
  socket.on('data', (buf) => {
    if ((buf[0] & 0x0f) === 0x8) socket.end(); // client close frame
  });
  const stop = () => clearInterval(timer);
  socket.on('close', stop);
  socket.on('error', stop);
}

const server = http.createServer(async (req, res) => {
  if (mock && (await mockApi(req, res))) return;
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    let f = join(root, p);
    try {
      if ((await stat(f)).isDirectory()) f = join(f, 'index.html');
    } catch {
      if (!extname(f)) f += '.html';
    }
    const body = await readFile(f);
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('nf');
  }
});
if (mock) server.on('upgrade', mockLive);
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const gpuArgs = flag('webgpu')
  ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-vulkan-surface']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ executablePath: '/opt/docgen-browsers/chromium-1208/chrome-linux64/chrome', headless: true, args: [...gpuArgs, '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr, reducedMotion: flag('reduced') ? 'reduce' : 'no-preference' });
if (opt('init', '')) await context.addInitScript(opt('init', ''));
if (flag('save-data')) {
  await context.addInitScript(() => Object.defineProperty(navigator, 'connection', { configurable: true, value: { saveData: true } }));
}
const page = await context.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`.slice(0, 400)));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`.slice(0, 600)));

for (let i = 0; i < urls.length; i++) {
  // Headless Chromium only has CPU-emulated GPUs; opt the swarm in unless --poster asks for the visitor default.
  const u = new URL(urls[i], 'http://x');
  if (!flag('poster') && !u.searchParams.has('swarm')) u.searchParams.set('swarm', 'software');
  const url = `http://localhost:${port}${u.pathname}${u.search}${u.hash}`;
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  try {
    await page.waitForFunction(() => window.__ready === true || document.readyState === 'complete', null, { timeout: 15000 });
  } catch {}
  if (evalJs) await page.evaluate(evalJs).catch((e) => logs.push('[eval] ' + e.message));
  if (scrolls.length) {
    for (const [j, y] of scrolls.entries()) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(wait);
      const out = (outs[i] || outs[0]).replace(/\.png$/, `-${j}.png`);
      await mkdir(dirname(out), { recursive: true });
      await page.screenshot({ path: out, timeout: shotTimeout });
      console.log('saved', out);
    }
  } else {
    await page.waitForTimeout(wait);
    const out = outs[i] || outs[0];
    await mkdir(dirname(out), { recursive: true });
    await page.screenshot({ path: out, fullPage, timeout: shotTimeout });
    console.log('saved', out, `(${Date.now() - t0} ms)`);
  }
  const stats = await page.evaluate(() => (window.__swarm ? window.__swarm.stats() : null)).catch(() => null);
  if (stats) console.log('stats', JSON.stringify(stats));
}
if (logs.length) console.log(logs.slice(0, 40).join('\n'));
await browser.close();
server.close();
