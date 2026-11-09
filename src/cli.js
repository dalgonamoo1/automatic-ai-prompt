#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { createHttpApp, readHttpConfig } from './http.js';

const args = process.argv.slice(2);
if (args[0] === 'setup' || args[0] === 'update') {
  const { runSetupCli } = await import('./setup-cli.js');
  process.exitCode = await runSetupCli(args.slice(1), { operation: args[0] });
} else if (['doctor', 'list', 'uninstall'].includes(args[0])) {
  const { runManagementCli } = await import('./manage-cli.js');
  process.exitCode = await runManagementCli(args[0], args.slice(1));
} else if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: automatic-ai-prompt <setup|update|doctor|list|uninstall> [options]\n       automatic-ai-prompt [--http]\nsetup: choose AI clients and register MCP + workflow instructions.\nupdate: update existing connections.\ndoctor: check registration, workflow rules, and MCP connectivity.\nlist: show registered apps and projects.\nuninstall: remove this tool’s connections and managed instructions.\nDefault: MCP over stdio. --http: Streamable HTTP on 127.0.0.1:3000/mcp.\nHTTP env: HOST, PORT, MCP_ALLOWED_HOSTS, MCP_AUTH_TOKEN (optional).');
} else if (args.some((arg) => arg !== '--http') || args.length > 1) {
  console.error('Unknown arguments. Run intent-bridge-mcp --help.');
  process.exitCode = 1;
} else {
  try {
    if (args.includes('--http')) {
      const config = readHttpConfig();
      const listener = createHttpApp(config).listen(config.port, config.host, () => {
        console.error(`Intent Bridge HTTP listening on port ${config.port}; endpoint /mcp`);
      });
      listener.on('error', () => { console.error('Unable to start HTTP server. Check HOST and PORT.'); process.exitCode = 1; });
      const shutdown = () => {
        listener.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 5000).unref();
      };
      process.once('SIGTERM', shutdown);
      process.once('SIGINT', shutdown);
    } else {
      const server = createServer();
      await server.connect(new StdioServerTransport());
      const shutdown = async () => { await server.close(); process.exit(0); };
      process.once('SIGTERM', shutdown);
      process.once('SIGINT', shutdown);
    }
  } catch {
    console.error('Intent Bridge could not start. Check the configuration and run --help.');
    process.exitCode = 1;
  }
}
