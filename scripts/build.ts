/**
 * Static build: bundles the client, inlines CSS, renders every page from
 * content/profile.ts, and writes the agent-facing files (llms.txt, agent card,
 * sitemap, security headers with CSP hashes). Run with Bun: `bun scripts/build.ts`.
 */
import { mkdir, rm, writeFile, readdir, copyFile, stat, readFile } from 'node:fs/promises';
import { join, dirname, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { execSync } from 'node:child_process';
import { routes, type BuildContext } from '../src/site/routes';
import { textFiles } from '../src/site/text-files';

const root = join(import.meta.dir, '..');
const dist = process.env.LOD_DIST ? resolve(process.env.LOD_DIST) : join(root, 'dist');
const isDev = process.argv.includes('--dev');
/** LOD_SITE_ENV=dev builds the dev site: same pages, but kept out of search engines. */
const siteEnv = process.env.LOD_SITE_ENV === 'dev' ? 'dev' : 'production';

function sha256b64(s: string): string {
  return createHash('sha256').update(s).digest('base64');
}

async function copyDir(from: string, to: string): Promise<void> {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.well-known') continue;
    const a = join(from, entry.name);
    const b = join(to, entry.name);
    if (entry.isDirectory()) await copyDir(a, b);
    else await copyFile(a, b);
  }
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

function gitInfo(): { sha: string; date: string } {
  try {
    const sha = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const date = execSync('git log -1 --format=%cI', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return { sha, date };
  } catch {
    return { sha: 'dev', date: new Date().toISOString() };
  }
}

export async function build(): Promise<BuildContext> {
  const t0 = performance.now();
  await rm(dist, { recursive: true, force: true });
  await mkdir(join(dist, 'assets'), { recursive: true });

  // 1. Client bundle (code-split: engine, agent, x-ray and audio load lazily).
  const js = await Bun.build({
    entrypoints: [join(root, 'src/client/main.ts')],
    outdir: join(dist, 'assets'),
    target: 'browser',
    format: 'esm',
    splitting: true,
    minify: !isDev,
    sourcemap: isDev ? 'inline' : 'none',
    naming: { entry: '[name]-[hash].[ext]', chunk: 'c-[hash].[ext]', asset: '[name]-[hash].[ext]' },
    define: { 'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'), __DEV__: String(isDev) },
  });
  if (!js.success) {
    for (const log of js.logs) console.error(log);
    throw new Error('client bundle failed');
  }
  const entry = js.outputs.find((o) => o.kind === 'entry-point');
  if (!entry) throw new Error('no entry output');
  const mainJs = '/' + relative(dist, entry.path).replaceAll('\\', '/');

  // 2. CSS: hand-written, so a conservative minifier is enough (comments + whitespace only).
  const cssSrc = await readFile(join(root, 'src/site/styles/main.css'), 'utf8');
  const css = isDev
    ? cssSrc
    : cssSrc
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*([{};,>])\s*/g, '$1')
        // "prop: value" and "(max-width: 960px)" never need the space; selectors never have one after ':'.
        .replace(/: /g, ':')
        .replace(/ !important/g, '!important')
        .replace(/;}/g, '}')
        .trim();

  // 3. Static files.
  await copyDir(join(root, 'public'), dist);

  // 4. Bundle stats (shown in x-ray mode and the colophon).
  const jsFiles = (await walk(join(dist, 'assets'))).filter((f) => f.endsWith('.js'));
  let jsRaw = 0;
  let jsGz = 0;
  let entryGz = 0;
  for (const f of jsFiles) {
    const buf = await readFile(f);
    jsRaw += buf.byteLength;
    const gz = gzipSync(buf, { level: 9 }).byteLength;
    jsGz += gz;
    if (f === entry.path) entryGz = gz;
  }
  const git = gitInfo();
  const ctx: BuildContext = {
    dev: isDev,
    builtAt: new Date().toISOString(),
    git,
    assets: { mainJs, css },
    stats: {
      jsFiles: jsFiles.length,
      jsRawBytes: jsRaw,
      jsGzipBytes: jsGz,
      entryGzipBytes: entryGz,
      cssGzipBytes: gzipSync(Buffer.from(css), { level: 9 }).byteLength,
      dependencies: 0,
    },
    cspHashes: { script: new Set<string>(), style: new Set<string>() },
  };

  // 5. Pages.
  for (const route of routes) {
    const page = route.render(ctx);
    const file = join(dist, route.file);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, page);
  }
  // HTML size stats after render.
  const home = await readFile(join(dist, 'index.html'));
  ctx.stats.htmlGzipBytes = gzipSync(home, { level: 9 }).byteLength;

  // 6. Agent-facing + crawler files.
  for (const [path, body] of Object.entries(textFiles(ctx))) {
    const file = join(dist, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  // 7. Headers: strict CSP with hashes for every inline script/style we emitted.
  const scriptHashes = [...ctx.cspHashes.script].map((h) => `'sha256-${h}'`).join(' ');
  const styleHashes = [...ctx.cspHashes.style].map((h) => `'sha256-${h}'`).join(' ');
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${scriptHashes} https://challenges.cloudflare.com https://static.cloudflareinsights.com`,
    `style-src 'self' ${styleHashes}`,
    "img-src 'self' data: https://i.ytimg.com",
    "font-src 'self'",
    "connect-src 'self' https://cloudflareinsights.com wss:",
    'frame-src https://challenges.cloudflare.com https://www.youtube-nocookie.com',
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
  const headers = `/*${siteEnv === 'dev' ? '\n  X-Robots-Tag: noindex, nofollow' : ''}
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), geolocation=(), payment=(), usb=(), microphone=(self)
  Cross-Origin-Opener-Policy: same-origin
  X-Frame-Options: DENY

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/fonts/*
  Cache-Control: public, max-age=31536000, immutable
  Access-Control-Allow-Origin: *

/llms.txt
  Content-Type: text/plain; charset=utf-8
  Access-Control-Allow-Origin: *

/llms-full.txt
  Content-Type: text/plain; charset=utf-8
  Access-Control-Allow-Origin: *

/.well-known/*
  Access-Control-Allow-Origin: *
`;
  await writeFile(join(dist, '_headers'), headers);
  if (siteEnv === 'dev') await writeFile(join(dist, 'robots.txt'), '# Dev site: not for search engines.\nUser-agent: *\nDisallow: /\n');
  await writeFile(join(dist, 'build.json'), JSON.stringify({ builtAt: ctx.builtAt, env: siteEnv, git: ctx.git, stats: ctx.stats }, null, 2));

  const ms = Math.round(performance.now() - t0);
  const kb = (n: number) => (n / 1024).toFixed(1) + ' KB';
  console.log(
    `built in ${ms} ms · JS ${kb(jsGz)} gz over ${jsFiles.length} files (entry ${kb(entryGz)}) · CSS ${kb(ctx.stats.cssGzipBytes)} gz · HTML ${kb(ctx.stats.htmlGzipBytes ?? 0)} gz`,
  );
  return ctx;
}

if (import.meta.main) {
  await build();
}

export { sha256b64, stat };
