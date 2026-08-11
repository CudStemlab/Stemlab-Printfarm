// MCP server for the print farm.
//
// Wraps the key-gated /api/v1 data API as Model Context Protocol tools so an LLM
// client (Claude Desktop / Claude Code, etc.) can monitor and control the farm.
// It holds no state and never touches Postgres — every tool is a fetch to
// /api/v1 (see apiClient.js), inheriting that API's auth, audit and redaction.
//
// One codebase, two transports (MCP_TRANSPORT):
//   - stdio: launched by a local MCP client; the single API key is PRINTFARM_API_KEY.
//   - http : Streamable HTTP behind nginx /mcp; the caller supplies their own
//            printfarm_manage key (Authorization: Bearer / X-Api-Key) on the
//            initialize request. The key is bound to that MCP session and used
//            for every /api/v1 call it makes, so audit attribution stays per-user.
//
// The HTTP request handling itself lives in httpHandler.js so the single-container
// build can mount it in-process on the web server's /mcp path instead of running
// this file as a second Node process (see server/app.js, EMBED_MCP).

import { createServer } from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from './server.js';
import { createMcpHttpHandler } from './httpHandler.js';

const transport = (process.env.MCP_TRANSPORT || 'http').toLowerCase();
const apiBase = process.env.PRINTFARM_API_BASE || 'http://web:5173';

if (transport === 'stdio') {
  await startStdio();
} else {
  startHttp();
}

async function startStdio() {
  const apiKey = process.env.PRINTFARM_API_KEY || '';
  if (!apiKey) {
    console.error('[printfarm-mcp] PRINTFARM_API_KEY is required for stdio transport');
    process.exit(1);
  }
  const server = createMcpServer({ apiBase, apiKey });
  await server.connect(new StdioServerTransport());
  // stdout is the MCP channel; logs must go to stderr.
  console.error(`[printfarm-mcp] ${SERVER_NAME} v${SERVER_VERSION} stdio ready (api ${apiBase})`);
}

function startHttp() {
  const port = Number.parseInt(process.env.MCP_PORT || '8092', 10);
  const host = process.env.HOST || '0.0.0.0';
  const handle = createMcpHttpHandler({ apiBase });

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      console.error('[printfarm-mcp]', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }));
      } else {
        res.end();
      }
    });
  });

  server.listen(port, host, () => {
    console.error(
      `[printfarm-mcp] ${SERVER_NAME} v${SERVER_VERSION} http listening on http://${host}:${port} (api ${apiBase})`,
    );
  });
}
