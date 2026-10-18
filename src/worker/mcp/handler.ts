/** Wires the profile MCP server into the Agents SDK's stateless HTTP handler. */
import { createMcpHandler } from 'agents/mcp/server';
import type { Env } from '../env';
import { allowedHostnames } from '../http';
import { createProfileServer } from './server';

type McpHandler = ReturnType<typeof createMcpHandler>;
const handlers = new Map<string, McpHandler>();

/**
 * One handler per allowed-host list. The SDK only takes exact hostnames, so this Worker's own
 * *.workers.dev host (and preview URLs) is added when the request arrives on it (see http.ts).
 */
export function mcpHandlerFor(env: Env, requestHostname: string): McpHandler {
  const hosts = allowedHostnames(env, requestHostname);
  const key = hosts.join(',');
  let handler = handlers.get(key);
  if (!handler) {
    handler = createMcpHandler(() => createProfileServer(), {
      route: '/mcp',
      // Host-header allow-list (DNS-rebinding protection).
      allowedHostnames: hosts,
      // Browser Origins that may call the server. Non-browser MCP clients send no Origin and pass.
      allowedOriginHostnames: hosts,
      // Serve 2025-era clients (initialize handshake) statelessly next to the 2026-07-28 protocol.
      legacy: 'stateless',
    });
    if (handlers.size >= 8) handlers.clear();
    handlers.set(key, handler);
  }
  return handler;
}
