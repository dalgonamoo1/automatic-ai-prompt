import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { getStaticTOMLValue, parseTOML } from 'toml-eslint-parser';
import { parse as parseJsonc } from 'jsonc-parser';
import { buildSetupPlan, applySetupPlan, removeJsonServer, removeTomlServer, removeInstructions, updateInstructions, INSTRUCTIONS_BEGIN } from '../src/setup-config.js';
import { loadConnectionState, connectionStateEdit } from '../src/setup-state.js';
import { connectionInventory, runManagementCli } from '../src/manage-cli.js';

const toml = (text) => getStaticTOMLValue(parseTOML(text));

test('removing a JSONC registration preserves other entries, preferences, comments and credentials', () => {
  const source = '{\n// keep this comment\n"theme":"dark", "mcpServers":{"intent-bridge":{"command":"node","args":[]},"other":{"command":"other","env":{"TOKEN":"test-only-value"}}}}';
  const result = removeJsonServer(source);
  assert.ok(result.includes('// keep this comment'));
  const expected = parseJsonc(source);
  delete expected.mcpServers['intent-bridge'];
  assert.deepEqual(parseJsonc(result), expected);
  assert.equal(removeJsonServer(result), result);
  assert.throws(() => removeJsonServer('{"mcpServers":{},"mcpServers":{}}'));
});

test('removing a TOML registration preserves unrelated sections and handles inline and dotted forms', () => {
  const fixtures = [
    '# keep\nmodel="sample"\n[mcp_servers."intent-bridge"]\ncommand="node"\n[mcp_servers."intent-bridge".env]\nTOKEN="fixture"\n[mcp_servers.other]\ncommand="other"\n',
    '# keep\nmcp_servers={"intent-bridge"={command="node"},other={command="other"}}\n',
    '# keep\nmcp_servers={other={command="other"},"intent-bridge"={command="node"}}\n',
    '# keep\nmcp_servers={other={command="other"},"intent-bridge"={command="node"},last={command="last"}}\n',
    '# keep\nmcp_servers={"intent-bridge"={command="node"}}\n',
    '# keep\nmcp_servers={other={command="other"},"intent-bridge".command="node","intent-bridge".args=[]}\n',
    '# keep\nmcp_servers={"intent-bridge".command="node","intent-bridge".args=[],other={command="other"}}\n',
    '# keep\nmcp_servers.intent-bridge.command="node"\nmcp_servers.intent-bridge.args=[]\nmcp_servers.other.command="other"\n',
    '# keep\n[mcp_servers]\n"intent-bridge"={command="node"}\nother={command="other"}\n',
    '# keep\nnote="""\n[mcp_servers.intent-bridge]\ncommand="keep this literal text"\n"""\n[mcp_servers.intent-bridge]\ncommand="node"\n[mcp_servers.other]\ncommand="other"\n',
  ];
  for (const source of fixtures) {
    const expected = toml(source);
    delete expected.mcp_servers['intent-bridge'];
    const result = removeTomlServer(source);
    assert.deepEqual(toml(result), expected);
    assert.ok(result.includes('# keep'));
    assert.doesNotThrow(() => parseTOML(result, { tomlVersion: '1.0.0' }));
    assert.equal(removeTomlServer(result), result);
  }
});

async function fixture(t, clients = ['codex', 'cursor', 'vscode']) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aip manage '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = { root, clients, homeDir: path.join(root, 'user'), projectDir: path.join(root, 'project'), platform: process.platform, env: {}, isolated: true,
    installDir: path.join(root, 'server'), instructions: 'Understand intent, clarify when necessary, and execute.' };
  options.entry = path.join(options.installDir, 'runtimes', 'c'.repeat(20), 'src', 'cli.js');
  await fs.mkdir(path.dirname(options.entry), { recursive: true });
  await fs.writeFile(path.resolve(path.dirname(options.entry), '../package.json'), '{"type":"module"}');
  const sourceCli = new URL('../src/cli.js', import.meta.url).href;
  await fs.writeFile(options.entry, `import ${JSON.stringify(sourceCli)};\n`);
  await fs.mkdir(path.join(options.homeDir, '.codex'), { recursive: true });
  await fs.writeFile(path.join(options.homeDir, '.codex', 'config.toml'), '# keep my settings\nmodel="example"\n[mcp_servers.other]\ncommand="other"\n');
  await fs.writeFile(path.join(options.homeDir, '.codex', 'AGENTS.md'), '# User instructions\nKeep this user instruction.\n');
  await fs.mkdir(path.join(options.projectDir, '.cursor'), { recursive: true });
  await fs.writeFile(path.join(options.projectDir, '.cursor', 'mcp.json'), '{\n// keep my settings\n"mcpServers":{"other":{"command":"other"}}}');
  const state = await loadConnectionState(options.installDir);
  const plan = await buildSetupPlan(options);
  await applySetupPlan([...plan, connectionStateEdit(state, plan.filter((item) => item.connection).map((item) => item.connection))]);
  options.plan = plan;
  return options;
}

async function run(operation, options, extra = [], dependencies = {}) {
  let output = '';
  let errors = '';
  const code = await runManagementCli(operation, ['--config-dir', options.homeDir, '--install-dir', options.installDir, '--json', ...extra], {
    output: { write: (text) => { output += text; } }, errorOutput: { write: (text) => { errors += text; } }, env: {}, ...dependencies,
  });
  assert.equal(errors, '');
  return { code, result: JSON.parse(output), raw: output };
}

test('list is read-only, finds saved projects, and never prints configured environment values', async (t) => {
  const options = await fixture(t, ['cursor']);
  const config = path.join(options.projectDir, '.cursor', 'mcp.json');
  const data = parseJsonc(await fs.readFile(config, 'utf8'));
  data.mcpServers['intent-bridge'].env = { TEST_TOKEN: 'not-a-real-secret' };
  await fs.writeFile(config, JSON.stringify(data));
  const before = await fs.readFile(config, 'utf8');
  const registry = await fs.readFile(path.join(options.installDir, 'connections.json'), 'utf8');
  const result = await run('list', options, [], { probe: async () => { throw new Error('list must not start servers'); } });
  assert.equal(result.code, 0);
  assert.equal(result.result.connections.length, 1);
  assert.equal(result.result.connections[0].status, 'registered');
  assert.equal(result.result.connections[0].config, config);
  assert.ok(!result.raw.includes('not-a-real-secret'));
  assert.ok(!result.raw.includes('TEST_TOKEN'));
  assert.equal(await fs.readFile(config, 'utf8'), before);
  assert.equal(await fs.readFile(path.join(options.installDir, 'connections.json'), 'utf8'), registry);
});

test('doctor performs a real MCP initialization and tool call without changing settings', async (t) => {
  const options = await fixture(t, ['codex']);
  const config = path.join(options.homeDir, '.codex', 'config.toml');
  const before = await fs.readFile(config, 'utf8');
  const result = await run('doctor', options);
  assert.equal(result.code, 0, result.raw);
  assert.equal(result.result.healthy, true);
  assert.equal(result.result.connections[0].checks.mcp, true);
  assert.ok(result.result.connections[0].tools.includes('refine_prompt'));
  assert.equal(await fs.readFile(config, 'utf8'), before);
});

test('doctor reports missing rules, disabled entries and probe failures without leaking error bodies', async (t) => {
  const options = await fixture(t, ['codex']);
  const rule = path.join(options.homeDir, '.codex', 'AGENTS.md');
  await fs.writeFile(rule, 'My rules only');
  let result = await run('doctor', options, [], { probe: async () => ({ tools: ['refine_prompt'] }) });
  assert.equal(result.code, 1);
  assert.equal(result.result.connections[0].checks.instructions, false);
  result = await run('doctor', options, [], { probe: async () => { throw new Error('sensitive-upstream-error-body'); } });
  assert.equal(result.code, 1);
  assert.ok(!result.raw.includes('sensitive-upstream-error-body'));
  const config = path.join(options.homeDir, '.codex', 'config.toml');
  await fs.appendFile(config, '\nenabled = false\n');
  let calls = 0;
  result = await run('doctor', options, [], { probe: async () => { calls++; return {}; } });
  assert.equal(result.code, 1);
  assert.equal(result.result.connections[0].disabled, true);
  assert.equal(calls, 0);
  await fs.appendFile(config, '\n[mcp_servers."intent-bridge"]\n');
  result = await run('doctor', options, [], { probe: async () => { throw new Error('should not run'); } });
  assert.equal(result.result.connections[0].status, 'invalid');
});

test('doctor probes a shared runtime once and refuses a non-Node launch command', async (t) => {
  const options = await fixture(t, ['codex', 'cursor']);
  let calls = 0;
  let result = await run('doctor', options, [], { probe: async () => { calls++; return { tools: ['refine_prompt'] }; } });
  assert.equal(result.code, 0, result.raw);
  assert.equal(calls, 1);
  const file = path.join(options.projectDir, '.cursor', 'mcp.json');
  const data = parseJsonc(await fs.readFile(file, 'utf8'));
  data.mcpServers['intent-bridge'].command = path.join(options.root, 'not-node');
  await fs.writeFile(file, JSON.stringify(data));
  calls = 0;
  result = await run('doctor', options, ['--client', 'cursor'], { probe: async () => { calls++; return {}; } });
  assert.equal(result.code, 1);
  assert.equal(calls, 0);
});

test('uninstall preserves other MCP servers and user rules, removes owned rule files, and is repeatable', async (t) => {
  const options = await fixture(t);
  const vscodeRule = path.join(options.projectDir, '.github', 'instructions', 'intent-bridge.instructions.md');
  await fs.appendFile(vscodeRule, '\nMy additional project rule.\n');
  const originalCatalog = await fs.readFile(path.join(options.installDir, 'connections.json'), 'utf8');
  const preview = await run('uninstall', options, ['--dry-run']);
  assert.equal(preview.code, 0);
  assert.equal(preview.result.dryRun, true);
  assert.equal(await fs.readFile(path.join(options.installDir, 'connections.json'), 'utf8'), originalCatalog);
  const result = await run('uninstall', options);
  assert.equal(result.code, 0, result.raw);
  const codex = toml(await fs.readFile(path.join(options.homeDir, '.codex', 'config.toml'), 'utf8'));
  assert.equal(codex.model, 'example');
  assert.equal(codex.mcp_servers.other.command, 'other');
  assert.equal(codex.mcp_servers['intent-bridge'], undefined);
  const cursor = parseJsonc(await fs.readFile(path.join(options.projectDir, '.cursor', 'mcp.json'), 'utf8'));
  assert.deepEqual(cursor.mcpServers, { other: { command: 'other' } });
  assert.ok((await fs.readFile(path.join(options.homeDir, '.codex', 'AGENTS.md'), 'utf8')).includes('Keep this user instruction.'));
  await assert.rejects(fs.access(path.join(options.projectDir, '.cursor', 'rules', 'intent-bridge.mdc')));
  const retained = await fs.readFile(vscodeRule, 'utf8');
  assert.ok(retained.includes('My additional project rule.'));
  assert.ok(!retained.includes(INSTRUCTIONS_BEGIN));
  assert.ok(result.result.backups.length > 0);
  await fs.access(options.entry);
  assert.equal((await loadConnectionState(options.installDir)).connections.length, 0);
  assert.deepEqual((await run('list', options)).result.connections, []);
  assert.deepEqual((await run('uninstall', options)).result.changed, []);
});

test('selective uninstall preserves unselected projects and cleans Codex override remnants', async (t) => {
  const options = await fixture(t, ['codex', 'cursor']);
  const override = path.join(options.homeDir, '.codex', 'AGENTS.override.md');
  await fs.writeFile(override, updateInstructions('User override\n', options.instructions));
  const cursorConfig = path.join(options.projectDir, '.cursor', 'mcp.json');
  const beforeCursor = await fs.readFile(cursorConfig, 'utf8');
  const result = await run('uninstall', options, ['--client', 'codex']);
  assert.equal(result.code, 0, result.raw);
  for (const file of ['AGENTS.md', 'AGENTS.override.md']) {
    const text = await fs.readFile(path.join(options.homeDir, '.codex', file), 'utf8');
    assert.ok(!text.includes(INSTRUCTIONS_BEGIN));
    assert.ok(text.includes('User') || text.includes('user'));
  }
  assert.equal(await fs.readFile(cursorConfig, 'utf8'), beforeCursor);
  assert.deepEqual((await loadConnectionState(options.installDir)).connections.map((item) => item.client), ['cursor']);
});

test('replaced registrations are preserved while this tool’s instruction remnants are removed', async (t) => {
  const options = await fixture(t, ['cursor']);
  const file = path.join(options.projectDir, '.cursor', 'mcp.json');
  const foreign = '{"mcpServers":{"intent-bridge":{"command":"another-server","args":[]}}}';
  await fs.writeFile(file, foreign);
  const result = await run('uninstall', options);
  assert.equal(result.code, 0);
  assert.equal(await fs.readFile(file, 'utf8'), foreign);
  assert.equal((await loadConnectionState(options.installDir)).connections.length, 0);
});

test('project-scoped management excludes global clients and leaves them connected', async (t) => {
  const options = await fixture(t);
  const listed = await run('list', options, ['--project', options.projectDir]);
  assert.deepEqual(new Set(listed.result.connections.map((row) => row.client)), new Set(['cursor', 'vscode']));
  const result = await run('uninstall', options, ['--project', options.projectDir]);
  assert.equal(result.code, 0);
  assert.deepEqual((await loadConnectionState(options.installDir)).connections.map((item) => item.client), ['codex']);
  assert.ok((await fs.readFile(path.join(options.homeDir, '.codex', 'AGENTS.md'), 'utf8')).includes(INSTRUCTIONS_BEGIN));
});

test('legacy instruction remnants can be removed without a catalog or an active MCP entry', async (t) => {
  const options = await fixture(t, ['codex']);
  await fs.unlink(path.join(options.installDir, 'connections.json'));
  const file = path.join(options.homeDir, '.codex', 'config.toml');
  const original = removeTomlServer(await fs.readFile(file, 'utf8'));
  await fs.writeFile(file, original);
  const listed = await run('list', options);
  assert.equal(listed.result.connections[0].status, 'missing');
  const result = await run('uninstall', options);
  assert.equal(result.code, 0, result.raw);
  assert.equal(await fs.readFile(file, 'utf8'), original);
  assert.ok(!((await fs.readFile(path.join(options.homeDir, '.codex', 'AGENTS.md'), 'utf8')).includes(INSTRUCTIONS_BEGIN)));
});

test('damaged instruction markers abort uninstall before any configuration is changed', async (t) => {
  const options = await fixture(t, ['codex']);
  const config = path.join(options.homeDir, '.codex', 'config.toml');
  const before = await fs.readFile(config, 'utf8');
  await fs.writeFile(path.join(options.homeDir, '.codex', 'AGENTS.md'), `${INSTRUCTIONS_BEGIN}\nUnclosed block`);
  const result = await run('uninstall', options);
  assert.equal(result.code, 1);
  assert.equal(await fs.readFile(config, 'utf8'), before);
  assert.equal((await loadConnectionState(options.installDir)).connections.length, 1);
});

test('a later write failure restores a file deleted earlier in the transaction', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aip remove rollback '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'owned-rule.md');
  await fs.writeFile(file, 'original rule');
  await assert.rejects(applySetupPlan([
    { file, before: 'original rule', after: null, mode: 0o600 },
    { file: path.join(root, 'invalid.json'), before: null, after: {}, mode: 0o600 },
  ]));
  assert.equal(await fs.readFile(file, 'utf8'), 'original rule');
  assert.throws(() => removeInstructions(`${INSTRUCTIONS_BEGIN} without end`));
});
