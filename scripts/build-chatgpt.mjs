import fs from 'node:fs/promises';
import { build } from 'esbuild';

await fs.mkdir('dist/server', { recursive: true });
await build({ entryPoints: ['src/chatgpt-worker.js'], outfile: 'dist/server/index.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'none' });
// Site identity is instance-specific. Never bake one user's Site ID into the
// public template: deployment copies its local manifest when present.
try {
  const manifest = JSON.parse(await fs.readFile('.openai/hosting.json', 'utf8'));
  if (!manifest.project_id || !manifest.capabilities?.includes('mcp') || manifest.static) throw new Error('A Worker Site requires project_id, mcp capability, and no static directory.');
  await fs.mkdir('dist/.openai', { recursive: true });
  await fs.writeFile('dist/.openai/hosting.json', JSON.stringify(manifest, null, 2) + '\n');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
console.log('Built ChatGPT MCP Worker: dist/server/index.js');
