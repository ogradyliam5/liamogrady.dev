/** POST /api/agent: validation, rate limiting, optional Turnstile, then an SSE stream from runAgent(). */
import type { Env } from '../env';
import { turnstileHostnames } from '../contact';
import { clientIp, edgeInfo, json, originAllowed, rateLimited, readJson } from '../http';
import { verifyTurnstile } from '../turnstile';
import { MeteredProvider, dailyTokenMeter } from '../budget';
import { resolveProviders } from './providers';
import { runAgent } from './run';
import { SSE_HEADERS, createSseStream, sseOnce } from './sse';
import { validateAgentRequest } from './validate';

const MAX_BODY_BYTES = 64 * 1024;

export async function handleAgent(request: Request, env: Env, ctx: Pick<ExecutionContext, 'waitUntil'>): Promise<Response> {
  if (!originAllowed(request, env)) return json({ ok: false, error: 'forbidden_origin' }, { status: 403 });

  const body = await readJson(request, MAX_BODY_BYTES);
  if (!body.ok) return json({ ok: false, error: body.error }, { status: body.status });
  const v = validateAgentRequest(body.value);
  if (!v.ok) return json({ ok: false, error: 'bad_request', field: v.field, message: v.message }, { status: 400 });

  const ip = clientIp(request);
  if (await rateLimited(env.RL_AI, `agent:${ip}`)) {
    return sseOnce(
      { type: 'error', code: 'rate_limited', message: 'That is a lot of questions in a minute. Give it a moment and try again.' },
      429,
      { 'Retry-After': '60' },
    );
  }

  // Turnstile: verified whenever a token is sent (and a secret is configured); required only when
  // AGENT_REQUIRE_TURNSTILE=1. The widget must be rendered with action "agent".
  if (env.TURNSTILE_SECRET && (v.value.turnstile || env.AGENT_REQUIRE_TURNSTILE === '1')) {
    const check = await verifyTurnstile({
      secret: env.TURNSTILE_SECRET,
      token: v.value.turnstile ?? '',
      ip,
      action: 'agent',
      hostnames: turnstileHostnames(env, new URL(request.url).hostname),
    });
    if (!check.ok) return json({ ok: false, error: 'turnstile_failed' }, { status: 403 });
  }

  const providers = resolveProviders(env);
  // Daily token budget (AGENT_DAILY_TOKENS), shared across every location through one Durable Object.
  const meter = providers.chat || providers.reason ? dailyTokenMeter(env, (p) => ctx.waitUntil(p)) : null;
  const metered = (p: typeof providers.chat) => (p && meter ? new MeteredProvider(p, meter) : p);
  const stream = createSseStream();
  const requestId = crypto.randomUUID();
  const work = runAgent({
    request: v.value,
    chat: metered(providers.chat),
    reason: metered(providers.reason),
    providerKind: providers.kind,
    colo: edgeInfo(request, env).colo,
    requestId,
    emit: (event) => stream.send(event),
  })
    .catch(async (err: unknown) => {
      console.error(`agent ${requestId} failed: ${err instanceof Error ? err.message : String(err)}`);
      await stream.send({ type: 'error', code: 'upstream', message: 'Something went wrong on our side. Please try again.' });
    })
    .finally(() => stream.close());
  ctx.waitUntil(work);
  return new Response(stream.readable, { headers: SSE_HEADERS });
}
