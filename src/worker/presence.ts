/**
 * Presence: one SQLite-backed Durable Object ("lobby") holding hibernating WebSockets, so idle
 * visitors cost nothing while connected. Protocol and validation live in presence-protocol.ts.
 *
 * Written as a plain class (no `cloudflare:workers` import) so src/worker/index.ts still loads
 * under Bun for scripts/dev.ts; workerd supports plain Durable Object classes and the Hibernation API.
 */
import type { Env } from './env';
import {
  MAX_ACTIVE_PEERS,
  MOVES_PER_SECOND,
  NOTES_PER_SECOND,
  allowInWindow,
  isAttachment,
  normaliseCountry,
  parseClientMessage,
  peerView,
  randomPeerId,
  type PeerAttachment,
} from './presence-protocol';

const PING = '{"t":"p"}';
const OPEN = 1;

function attachmentOf(ws: WebSocket): PeerAttachment | null {
  try {
    const a: unknown = ws.deserializeAttachment();
    return isAttachment(a) ? a : null;
  } catch {
    return null;
  }
}

export class Presence {
  private readonly notes = new Map<string, number[]>();
  private readonly moves = new Map<string, number[]>();
  private readonly gone = new Set<string>();

  constructor(
    private readonly ctx: DurableObjectState,
    _env: Env,
  ) {
    // The exact ping frame is answered by the runtime without waking the object.
    try {
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PING));
    } catch {
      /* not available: webSocketMessage answers pings instead */
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected a WebSocket upgrade', { status: 426, headers: { Upgrade: 'websocket' } });
    }
    const open = this.ctx.getWebSockets().filter((ws) => ws.readyState === OPEN);
    const others = open.map(attachmentOf).filter((a): a is PeerAttachment => a !== null);
    const observer = others.filter((a) => !a.o).length >= MAX_ACTIVE_PEERS;

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const me: PeerAttachment = {
      id: randomPeerId(),
      c: normaliseCountry(request.headers.get('X-Presence-Country')),
      t: Date.now(),
      ...(observer ? { o: 1 as const } : {}),
    };
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(me);
    server.send(
      JSON.stringify({
        t: 'welcome',
        id: me.id,
        here: open.length + 1,
        peers: others.filter((a) => !a.o).map(peerView),
        ...(observer ? { observer: true } : {}),
      }),
    );
    if (!observer) this.broadcast({ t: 'join', id: me.id, c: me.c }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const me = attachmentOf(ws);
    if (!me || me.o) return; // observers are receive-only
    const msg = parseClientMessage(message);
    if (!msg) return;
    if (msg.t === 'p') {
      ws.send(PING);
      return;
    }
    const now = Date.now();
    if (msg.t === 'm') {
      const r = allowInWindow(this.moves.get(me.id) ?? [], now, MOVES_PER_SECOND);
      this.moves.set(me.id, r.history);
      if (!r.ok) return;
      me.x = msg.x;
      me.y = msg.y;
      me.s = msg.s;
      ws.serializeAttachment(me);
      this.broadcast({ t: 'm', id: me.id, x: msg.x, y: msg.y, s: msg.s }, ws);
      return;
    }
    const r = allowInWindow(this.notes.get(me.id) ?? [], now, NOTES_PER_SECOND);
    this.notes.set(me.id, r.history);
    if (r.ok) this.broadcast({ t: 'n', id: me.id, n: msg.n }, ws);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.leave(ws);
    try {
      ws.close(code >= 3000 && code <= 4999 ? code : 1000, reason.slice(0, 120));
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.leave(ws);
  }

  private leave(ws: WebSocket): void {
    const me = attachmentOf(ws);
    if (!me || this.gone.has(me.id)) return;
    if (this.gone.size > 2000) this.gone.clear();
    this.gone.add(me.id);
    this.notes.delete(me.id);
    this.moves.delete(me.id);
    if (!me.o) this.broadcast({ t: 'leave', id: me.id }, ws);
  }

  private broadcast(msg: Record<string, unknown>, except?: WebSocket): void {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except || ws.readyState !== OPEN) continue;
      try {
        ws.send(data);
      } catch {
        /* closing */
      }
    }
  }
}
