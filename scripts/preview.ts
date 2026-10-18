/**
 * Builds one self-contained HTML file (fonts, CSS and JavaScript inlined) so the
 * site can be reviewed by double-clicking it, before anything is deployed.
 * Live-only features (the model-backed agent, presence, edge data) fall back gracefully;
 * the agent answers in offline mode from the same public profile.
 *   bun scripts/preview.ts [outFile]
 */
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';

const root = join(import.meta.dir, '..');
const tmp = '/tmp/lod-preview-dist';
const outFile = resolve(process.argv[2] ?? join(root, '..', 'preview', 'liamogrady-dev-preview.html'));

process.env.LOD_DIST = tmp;
const { build } = await import('./build');
const ctx = await build();

// One JS bundle, no code splitting, so it can live inside a <script> tag.
const js = await Bun.build({
  entrypoints: [join(root, 'src/client/main.ts')],
  target: 'browser',
  format: 'esm',
  splitting: false,
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false', __PREVIEW__: 'true' },
});
if (!js.success) throw new Error(js.logs.join('\n'));
const code = (await js.outputs[0]!.text()).replace(/<\/script/gi, '<\\/script');

let html = await readFile(join(tmp, 'index.html'), 'utf8');

// Fonts → data URLs (inside the inlined <style>).
for (const f of await readdir(join(root, 'public/fonts'))) {
  if (!f.endsWith('.woff2')) continue;
  const b64 = (await readFile(join(root, 'public/fonts', f))).toString('base64');
  html = html.replaceAll(`/fonts/${f}`, `data:font/woff2;base64,${b64}`);
}
// Drop font preloads (now inline) and absolute links that make no sense from a file.
html = html.replace(/<link rel="preload"[^>]*>/g, '').replace(/<link rel="manifest"[^>]*>/, '');
const favicon = (await readFile(join(root, 'public/favicon.svg'))).toString('base64');
html = html.replace('href="/favicon.svg"', `href="data:image/svg+xml;base64,${favicon}"`);
// Replace the external module with the inline bundle; expose build stats for X-ray.
html = html.replace(/<script type="module" src="[^"]+"><\/script>/, () => `<script>window.__LOD_BUILD=${JSON.stringify({ builtAt: ctx.builtAt, git: ctx.git, stats: ctx.stats })}</script><script type="module">${code}</script>`);
// Local section links instead of site-relative ones.
html = html.replaceAll('href="/#', 'href="#');
// A discreet banner.
html = html.replace(
  '<a class="skip-link"',
  `<div style="position:fixed;z-index:90;right:.75rem;bottom:.75rem;font:500 12px/1.4 var(--font-mono);color:#05070b;background:#f2b94b;padding:.3rem .7rem;border-radius:999px;box-shadow:0 8px 30px -10px #000">Offline preview · live agent, presence &amp; edge data switch on when deployed</div><a class="skip-link"`,
);

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, html);
console.log(`preview → ${outFile} (${(html.length / 1024).toFixed(0)} KB)`);
