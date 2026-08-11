// Streamable-HTTP request handler for the MCP server, extracted from index.js so
// it can be driven two ways from one implementation:
//
//   - as its own `mcp` container (mcp/index.js creates an http server around it),
//   - mounted in-process on the web server's `/mcp` path in the single-container
//     build (server/app.js, EMBED_MCP=true), where there is no nginx to proxy
//     mcp:8092 and no second Node process to run it.
//
// The session map is in-memory and single-process either way (same caveat as
// eventStream.js / statusLightBroker.js): run one MCP surface per deployment.

import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from './server.js';

// Bound the in-memory session map so a client that opens sessions without ever
// sending DELETE can't leak them until process restart.
const SESSION_TTL_MS = Number.parseInt(process.env.MCP_SESSION_TTL_MS || String(30 * 60 * 1000), 10);
const MAX_SESSIONS = Number.parseInt(process.env.MCP_MAX_SESSIONS || '256', 10);

export { SERVER_NAME, SERVER_VERSION };

// Returns an async (req, res) handler plus a close() for shutdown. `apiBase` is
// the /api/v1 origin every tool call is proxied to (the web server itself when
// embedded, http://web:5173 when running as its own container).
export function createMcpHttpHandler({ apiBase }) {
  // Session id -> { transport, server, lastSeen }.
  const sessions = new Map();

  // Evict sessions idle past the TTL. transport.close() fires onclose, which
  // removes the entry and closes its server. unref() so this never keeps the
  // process alive on its own.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [, entry] of sessions) {
      if (now - entry.lastSeen > SESSION_TTL_MS) {
        entry.transport.close().catch(() => {});
      }
    }
  }, 60 * 1000);
  sweeper.unref();

  async function handler(req, res) {
    await handleHttp(req, res, sessions, apiBase);
  }

  handler.close = () => {
    clearInterval(sweeper);
    for (const [, entry] of sessions) entry.transport.close().catch(() => {});
    sessions.clear();
  };

  return handler;
}

async function handleHttp(req, res, sessions, apiBase) {
  const url = new URL(req.url || '/', 'http://localhost');

  // Cheap liveness probe (not part of the MCP protocol).
  if (req.method === 'GET' && (url.pathname === '/healthz' || url.pathname.endsWith('/healthz'))) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, server: SERVER_NAME, version: SERVER_VERSION }));
    return;
  }

  const sessionId = header(req, 'mcp-session-id');

  // Established-session request (POST follow-ups, GET SSE stream, DELETE teardown).
  if (sessionId) {
    const entry = sessions.get(sessionId);
    if (!entry) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(jsonRpcError(null, -32001, 'Unknown or expired MCP session.'));
      return;
    }
    entry.lastSeen = Date.now();
    const body = req.method === 'POST' ? await readJsonBody(req) : undefined;
    await entry.transport.handleRequest(req, res, body);
    return;
  }

  // No session id: only a POST carrying an `initialize` request may open one.
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' });
    res.end(jsonRpcError(null, -32000, 'Method not allowed without an MCP session. POST initialize first.'));
    return;
  }

  const body = await readJsonBody(req);
  if (!isInitializeRequest(body)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(jsonRpcError(null, -32000, 'Missing mcp-session-id; the first request must be initialize.'));
    return;
  }

  // Opening a session: the caller's key is captured here and bound to it.
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' });
    res.end(
      jsonRpcError(
        null,
        -32001,
        'A valid printfarm_manage API key is required (Authorization: Bearer <key> or X-Api-Key header).',
      ),
    );
    return;
  }

  if (sessions.size >= MAX_SESSIONS) {
    res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '60' });
    res.end(jsonRpcError(null, -32000, 'Too many active MCP sessions; try again shortly.'));
    return;
  }

  const mcp = createMcpServer({ apiBase, apiKey });
  const httpTransport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sid) => {
      sessions.set(sid, { transport: httpTransport, server: mcp, lastSeen: Date.now() });
    },
  });
  httpTransport.onclose = () => {
    const sid = httpTransport.sessionId;
    if (sid && sessions.has(sid)) {
      sessions.delete(sid);
      mcp.close().catch(() => {});
    }
  };

  await mcp.connect(httpTransport);
  await httpTransport.handleRequest(req, res, body);
}

function header(req, name) {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : typeof v === 'string' ? v : '';
}

function extractApiKey(req) {
  const headerKey = header(req, 'x-api-key');
  if (headerKey && headerKey.trim()) return headerKey.trim();
  const auth = header(req, 'authorization');
  if (auth && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, '').trim();
  return '';
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const max = 4 * 1024 * 1024; // MCP payloads are small; cap to avoid abuse.
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > max) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function jsonRpcError(id, code, message) {
  return JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id });
}
