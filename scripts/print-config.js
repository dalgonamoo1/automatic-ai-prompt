import { fileURLToPath } from 'node:url';

const client = process.argv[2] || 'claude';
const entry = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const connection = { command: process.execPath, args: [entry] };
if (client === 'codex') {
  console.log(`[mcp_servers.intent-bridge]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(entry)}]`);
} else if (client === 'vscode') {
  console.log(JSON.stringify({ servers: { 'intent-bridge': { type: 'stdio', ...connection } } }, null, 2));
} else if (['claude', 'cursor'].includes(client)) {
  console.log(JSON.stringify({ mcpServers: { 'intent-bridge': connection } }, null, 2));
} else {
  console.error('Supported clients: claude, cursor, vscode, codex');
  process.exitCode = 1;
}
