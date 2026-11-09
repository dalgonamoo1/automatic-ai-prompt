import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';

function matchesToken(header, token) {
  if (typeof header !== 'string') return false;
  const actual = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createHttpApp({ allowedHosts = ['localhost', '127.0.0.1', '[::1]'], token } = {}) {
  const app = express();
  app.disable('x-powered-by');

  // Validate both Host and Origin: localhost MCP services must resist DNS rebinding.
  app.use((req, res, next) => {
    const hostname = req.hostname.toLowerCase();
    if (!allowedHosts.includes(hostname)) return res.status(403).json({ error: 'Host is not allowed.' });
    if (req.headers.origin) {
      try {
        const origin = new URL(req.headers.origin);
        if (!['http:', 'https:'].includes(origin.protocol) || !allowedHosts.includes(origin.hostname.toLowerCase())) {
          return res.status(403).json({ error: 'Origin is not allowed.' });
        }
      } catch {
        return res.status(403).json({ error: 'Origin is not allowed.' });
      }
    }
    next();
  });

  app.get('/health', (_req, res) => res.json({ status: 'ok', name: 'intent-bridge-mcp' }));
  app.use('/mcp', (req, res, next) => {
    if (token && !matchesToken(req.headers.authorization, token)) {
      return res.status(401).json({ error: 'A valid bearer token is required.' });
    }
    next();
  });
  app.use('/mcp', express.json({ limit: '128kb' }));
  app.post('/mcp', async (req, res) => {
    // A new server and transport per request: no user state or request history.
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const close = () => { void server.close().catch(() => {}); };
    res.once('close', close);
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ error: 'MCP request failed.' });
    }
  });
  app.all('/mcp', (_req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'This stateless MCP endpoint supports POST only.' });
  });
  // Never echo user input, request bodies, or bearer tokens in errors or logs.
  app.use((err, _req, res, _next) => {
    const status = err.type === 'entity.too.large' ? 413 : err.type === 'entity.parse.failed' ? 400 : 500;
    res.status(status).json({ error: status === 413 ? 'Request body is too large.' : status === 400 ? 'Invalid JSON.' : 'Request failed.' });
  });
  return app;
}

export function readHttpConfig(env = process.env) {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  const host = env.HOST || '127.0.0.1';
  const defaultHosts = ['localhost', '127.0.0.1', '[::1]', env.RENDER_EXTERNAL_HOSTNAME].filter(Boolean).join(',');
  const allowedHosts = (env.MCP_ALLOWED_HOSTS || defaultHosts)
    .split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!allowedHosts.length || allowedHosts.some((item) => !/^(?:[a-z0-9.-]+|\[::1\])$/.test(item))) {
    throw new Error('MCP_ALLOWED_HOSTS must contain exact hostnames without schemes, ports, or wildcards.');
  }
  const token = env.MCP_AUTH_TOKEN;
  if (token !== undefined && (!token.trim() || /[\r\n]/.test(token))) throw new Error('MCP_AUTH_TOKEN must be nonempty and contain no newlines.');
  return { port, host, allowedHosts, token };
}
