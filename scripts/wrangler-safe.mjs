#!/usr/bin/env node
/**
 * wrangler-safe: the only way this repo runs wrangler.
 *
 * Why it exists: the global `wrangler login` (OAuth) on Liam's PC belongs to his band's
 * Cloudflare account (The Kings of Connaught). Wrangler prefers CLOUDFLARE_API_TOKEN over
 * the stored OAuth token, so every local command runs with a dummy token and a dummy
 * account id. Anything that tries to reach the Cloudflare API therefore fails closed
 * instead of touching the band's account.
 *
 *   node scripts/wrangler-safe.mjs dev [args]      local dev (remote mode is refused)
 *   node scripts/wrangler-safe.mjs types [args]    generate binding types
 *   node scripts/wrangler-safe.mjs deploy [args]   only with explicit credentials + LOD_DEPLOY=1
 *   node scripts/wrangler-safe.mjs secret put NAME same guard as deploy
 *   node scripts/wrangler-safe.mjs --version
 *
 * Everything else (login, logout, whoami, versions, tail, kv, d1, ...) is refused.
 * WRANGLER_SAFE_DRY_RUN=1 prints what would run (credentials redacted) without running it.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DUMMY_TOKEN = 'lod-dev-dummy-token';
export const DUMMY_ACCOUNT = '00000000000000000000000000000000';

const LOCAL_COMMANDS = new Set(['dev', 'types', '--version', '-v', 'version', '--help', '-h', 'help']);
// Commands that act on a Cloudflare account: explicit credentials for Liam's own account only.
const GUARDED_COMMANDS = new Set(['deploy', 'secret']);
// Flags that would reach Cloudflare (remote dev, tunnels), pick a stored auth profile, or write outside the repo.
const REFUSED_FLAGS = new Set([
  '--remote',
  '-r',
  '--x-remote-bindings',
  '--experimental-remote-bindings',
  '--tunnel',
  '--tunnel-name',
  '--tunnel-allowed-mail',
  '--profile',
  '--install-skills',
]);

const DEPLOY_HELP = `
Refusing to run an account command (deploy / secret).

This PC's global wrangler login belongs to The Kings of Connaught's Cloudflare account,
so deploys only run with credentials you pass explicitly for Liam's OWN account:

  1. Create an API token in Liam's Cloudflare account (template "Edit Cloudflare Workers",
     scoped to that account and the liamogrady.dev zone).
  2. In a fresh PowerShell window:
       $env:CLOUDFLARE_API_TOKEN = '<token for Liam's account>'
       $env:CLOUDFLARE_ACCOUNT_ID = '<Liam's account id>'
       $env:LOD_DEPLOY = '1'
       npm run deploy
  3. Close that window afterwards (or Remove-Item Env:CLOUDFLARE_API_TOKEN, Env:LOD_DEPLOY).

See docs/WORKER.md ("Account safety" and "Deploying").
`;

function isDummyAccount(id) {
  return !id || id === DUMMY_ACCOUNT || /^0+$/.test(id);
}

/** Problems that block a deploy (empty array = allowed). */
export function deployProblems(env) {
  const problems = [];
  const token = env.CLOUDFLARE_API_TOKEN ?? '';
  if (!token || token === DUMMY_TOKEN) problems.push('CLOUDFLARE_API_TOKEN is not set to a real token for Liam\'s own account');
  if (isDummyAccount(env.CLOUDFLARE_ACCOUNT_ID ?? '')) problems.push('CLOUDFLARE_ACCOUNT_ID is not set to Liam\'s own account id');
  if (env.LOD_DEPLOY !== '1') problems.push('LOD_DEPLOY=1 is not set');
  return problems;
}

/** Decide what to run. Pure, so the guard rails are testable. */
export function plan(argv, env) {
  const [command, ...rest] = argv;
  if (!command) return { action: 'refuse', code: 2, message: 'usage: node scripts/wrangler-safe.mjs <dev|types|deploy|--version> [args]' };

  if (GUARDED_COMMANDS.has(command)) {
    const problems = deployProblems(env);
    if (problems.length) {
      return { action: 'refuse', code: 1, message: `${problems.map((p) => `  - ${p}`).join('\n')}\n${DEPLOY_HELP}` };
    }
    // Explicit credentials only: drop any global-API-key auth so nothing else can be picked up.
    const childEnv = { ...env, WRANGLER_SEND_METRICS: 'false' };
    delete childEnv.CLOUDFLARE_API_KEY;
    delete childEnv.CLOUDFLARE_EMAIL;
    return { action: 'run', args: [command, ...rest], env: childEnv };
  }

  if (!LOCAL_COMMANDS.has(command)) {
    return {
      action: 'refuse',
      code: 1,
      message: `Refusing "wrangler ${command}": only dev, types, deploy (guarded) and --version run through this wrapper.\nThe global wrangler login on this PC belongs to the band's Cloudflare account. See docs/WORKER.md.`,
    };
  }
  const refused = rest.find((a) => REFUSED_FLAGS.has(a.split('=')[0]));
  if (refused) {
    return { action: 'refuse', code: 1, message: `Refusing "${refused}": it needs a Cloudflare account or login. Local mode only.` };
  }
  // `--local` disables remote bindings (Workers AI would otherwise open an authenticated proxy session).
  const args = command === 'dev' && !rest.some((a) => a === '--local' || a === '-l') ? [command, ...rest, '--local'] : [command, ...rest];
  const childEnv = {
    ...env,
    CLOUDFLARE_API_TOKEN: DUMMY_TOKEN,
    CLOUDFLARE_ACCOUNT_ID: DUMMY_ACCOUNT,
    WRANGLER_SEND_METRICS: 'false',
  };
  delete childEnv.CLOUDFLARE_API_KEY;
  delete childEnv.CLOUDFLARE_EMAIL;
  return { action: 'run', args, env: childEnv };
}

function wranglerBin() {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');
}

function main() {
  const decision = plan(process.argv.slice(2), process.env);
  if (decision.action === 'refuse') {
    console.error(decision.message);
    process.exit(decision.code);
  }
  if (process.env.WRANGLER_SAFE_DRY_RUN === '1') {
    const show = (v) => (v === DUMMY_TOKEN || v === DUMMY_ACCOUNT ? v : v ? '<explicit>' : '<unset>');
    console.log(JSON.stringify({ args: decision.args, CLOUDFLARE_API_TOKEN: show(decision.env.CLOUDFLARE_API_TOKEN), CLOUDFLARE_ACCOUNT_ID: show(decision.env.CLOUDFLARE_ACCOUNT_ID) }));
    process.exit(0);
  }
  if (GUARDED_COMMANDS.has(decision.args[0])) {
    const id = decision.env.CLOUDFLARE_ACCOUNT_ID;
    console.error(`wrangler-safe: running "${decision.args[0]}" against the explicitly provided account …${id.slice(-4)}`);
  }
  const child = spawn(process.execPath, [wranglerBin(), ...decision.args], { stdio: 'inherit', env: decision.env });
  const forward = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.on('SIGINT', forward);
  process.on('SIGTERM', forward);
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

const invokedDirectly = Boolean(process.argv[1]) && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (invokedDirectly) main();
