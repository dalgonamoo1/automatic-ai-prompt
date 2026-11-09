import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse as parseJsonc } from 'jsonc-parser';
import { parseTOML, getStaticTOMLValue } from 'toml-eslint-parser';
import { updateJson, updateToml, updateInstructions, buildSetupPlan, applySetupPlan, clientFiles, selectClients } from '../src/setup-config.js';
import { parseSetupArgs } from '../src/setup-cli.js';
import { defaultInstallDir, findNpmCli, runtimeLocation } from '../src/setup-runtime.js';

const connection = { command: 'C:\\Program Files\\nodejs\\node.exe', args: ['C:\\Users\\Test User\\servers\\cli.js'] };
const readToml = (text) => getStaticTOMLValue(parseTOML(text));

test('JSONC updates preserve unrelated clients, settings, comments, and paths with spaces', () => {
  const source = '{\n // keep my note\n "theme": "dark",\n "mcpServers": {"other": {"command": "other"}},\n}\n';
  const result = updateJson(source, connection);
  assert.ok(result.includes('// keep my note'));
  assert.equal(parseJsonc(result).theme, 'dark');
  assert.deepEqual(parseJsonc(result).mcpServers.other, { command: 'other' });
  assert.deepEqual(parseJsonc(result).mcpServers['intent-bridge'], connection);
  assert.equal(updateJson(result, connection), result);
});

test('invalid JSON, duplicate keys and wrong server containers are rejected', () => {
  for (const source of ['{private-invalid', '[]', '{"mcpServers": []}', '{"mcpServers": {}, "mcpServers": {}}']) {
    assert.throws(() => updateJson(source, connection));
  }
  assert.throws(() => updateJson('{// comment\n}', connection, { strict: true }));
  assert.throws(() => updateJson('{"trailing": 1,}', connection, { strict: true }));
});

test('TOML updates handle tables, dotted keys and inline tables without altering other data', () => {
  const fixtures = [
    '# keep my note\nmodel="sample"\n[mcp_servers.other]\ncommand="other"\n',
    '# keep my note\nmcp_servers={other={command="other"}}\n',
    '# keep my note\nmcp_servers={other={command="other"},}\n',
    '# keep my note\nmcp_servers={other={command="other"}, "intent-bridge"={command="old",args=[]}}\n',
    '# keep my note\nmcp_servers.other.command="other"\nmcp_servers.intent-bridge.command="old"\nmcp_servers.intent-bridge.args=[]\n',
    '# keep my note\n[mcp_servers]\nother={command="other"}\n"intent-bridge"={command="old", args=[]}\n',
    '# keep my note\n[mcp_servers."intent-bridge"]\ncommand="old"\n[mcp_servers."intent-bridge".env]\nOLD="value"\n[mcp_servers.other]\ncommand="other"\n',
    '# keep my note\nnote="""\n[mcp_servers.intent-bridge]\ncommand="do not touch this string"\n"""\n[mcp_servers.other]\ncommand="other"\n',
  ];
  for (const source of fixtures) {
    const before = readToml(source);
    const result = updateToml(source, connection);
    const after = readToml(result);
    assert.deepEqual(after.mcp_servers['intent-bridge'], connection);
    delete before.mcp_servers['intent-bridge'];
    delete after.mcp_servers['intent-bridge'];
    assert.deepEqual(after, before);
    assert.ok(result.includes('# keep my note'));
    assert.equal(updateToml(result, connection), result);
  }
  assert.throws(() => updateToml('model = [', connection));
  assert.throws(() => updateToml('mcp_servers = 42', connection));
});

test('managed instruction blocks update once and preserve user text', () => {
  const first = updateInstructions('# My rules\nKeep this line.\n', 'Workflow v1');
  const second = updateInstructions(first, 'Workflow v2');
  assert.ok(second.includes('Keep this line.'));
  assert.ok(!second.includes('Workflow v1'));
  assert.equal(second.split('Workflow v2').length, 2);
  assert.equal(updateInstructions(second, 'Workflow v2'), second);
  assert.throws(() => updateInstructions('<!-- automatic-ai-prompt:begin -->', 'New rules'));
});

async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aip setup '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('setup registers all six clients with backups and idempotent rules in an isolated config root', async (t) => {
  const root = await temporary(t);
  const homeDir = path.join(root, 'user');
  const projectDir = path.join(root, 'project');
  const options = {
    clients: ['codex', 'claude_code', 'gemini_cli', 'cursor', 'vscode', 'claude_desktop'],
    homeDir, projectDir, platform: 'win32', isolated: true, env: {},
    entry: path.join(root, 'permanent server', 'src', 'cli.js'), instructions: 'Understand intent, clarify, then execute.',
  };
  const original = '# keep this\nmodel="example"\n[mcp_servers.other]\ncommand="existing"\n';
  await fs.mkdir(path.join(homeDir, '.codex'), { recursive: true });
  await fs.writeFile(path.join(homeDir, '.codex', 'config.toml'), original);
  const plan = await buildSetupPlan(options);
  const result = await applySetupPlan(plan);
  assert.equal(result.changed.length, 11);
  assert.equal(result.backups.length, 1);
  assert.equal(await fs.readFile(result.backups[0], 'utf8'), original);
  for (const id of options.clients) {
    const files = clientFiles(id, options);
    const content = await fs.readFile(files.config, 'utf8');
    const parsed = id === 'codex' ? readToml(content) : JSON.parse(content);
    const server = parsed[id === 'codex' ? 'mcp_servers' : id === 'vscode' ? 'servers' : 'mcpServers']['intent-bridge'];
    assert.equal(server.command, process.execPath);
    assert.deepEqual(server.args, [options.entry]);
    if (files.rules) assert.ok((await fs.readFile(files.rules, 'utf8')).includes(options.instructions));
  }
  assert.ok((await fs.readFile(clientFiles('cursor', options).rules, 'utf8')).includes('alwaysApply: true'));
  assert.ok((await fs.readFile(clientFiles('vscode', options).rules, 'utf8')).includes('applyTo: "**"'));
  const repeated = await applySetupPlan(await buildSetupPlan(options));
  assert.deepEqual(repeated, { changed: [], backups: [] });
});

test('preflight errors and concurrent edits never overwrite existing settings', async (t) => {
  const root = await temporary(t);
  const file = path.join(root, 'settings.json');
  await fs.writeFile(file, 'original');
  const plan = [{ file, before: 'original', after: 'installer version', mode: 0o600 }];
  await fs.writeFile(file, 'user edited this meanwhile');
  await assert.rejects(applySetupPlan(plan), /설정이 변경/);
  assert.equal(await fs.readFile(file, 'utf8'), 'user edited this meanwhile');
  const options = { clients: ['codex', 'gemini_cli'], homeDir: root, projectDir: root, platform: 'linux', isolated: true, env: {}, entry: '/server/cli.js', instructions: 'Rules' };
  await fs.mkdir(path.join(root, '.gemini'), { recursive: true });
  await fs.writeFile(path.join(root, '.gemini', 'settings.json'), '{private-invalid');
  await assert.rejects(buildSetupPlan(options), /JSON/);
  await assert.rejects(fs.access(path.join(root, '.codex', 'config.toml')));
});

test('a failed multi-file write restores earlier settings', async (t) => {
  const root = await temporary(t);
  const first = path.join(root, 'first.json');
  const second = path.join(root, 'second.json');
  await fs.writeFile(first, 'original');
  await assert.rejects(applySetupPlan([
    { file: first, before: 'original', after: 'changed', mode: 0o600 },
    // A write failure after the first file has changed must trigger rollback.
    { file: second, before: null, after: {}, mode: 0o600 },
  ]), /복원/);
  assert.equal(await fs.readFile(first, 'utf8'), 'original');
  await assert.rejects(fs.access(second));
});

test('setup respects Codex overrides and does not append to ignored global instructions', async (t) => {
  const root = await temporary(t);
  await fs.mkdir(path.join(root, '.codex'), { recursive: true });
  await fs.writeFile(path.join(root, '.codex', 'AGENTS.override.md'), 'User rules\n');
  const plan = await buildSetupPlan({ clients: ['codex'], homeDir: root, projectDir: root, platform: 'linux', isolated: true, env: {}, entry: '/server/cli.js', instructions: 'Auto workflow' });
  assert.ok(plan.some((item) => item.file.endsWith('AGENTS.override.md')));
  assert.ok(!plan.some((item) => item.file.endsWith('/AGENTS.md')));
});

test('noninteractive setup dry-run performs no installation or config writes', async (t) => {
  const root = await temporary(t);
  const userDir = path.join(root, 'new user');
  const installDir = path.join(root, 'permanent server');
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'setup', '--client', 'codex,cursor', '--dry-run', '--config-dir', userDir, '--install-dir', installDir, '--project', path.join(root, 'project')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /미리보기 완료/);
  assert.match(result.stdout, /intent-bridge.mdc/);
  await assert.rejects(fs.access(userDir));
  await assert.rejects(fs.access(installDir));
});

test('client selection validates aliases and unsupported clients', () => {
  assert.deepEqual(selectClients(['codex,claude', 'gemini_cli', 'codex']), ['codex', 'claude_code', 'gemini_cli']);
  assert.throws(() => selectClients(['unknown']));
  assert.throws(() => selectClients(['claude_desktop'], 'linux'));
  assert.throws(() => parseSetupArgs(['--client']));
  assert.throws(() => parseSetupArgs(['--unknown']));
});

test('persistent runtime paths are stable, outside package caches, and follow source updates', async (t) => {
  const root = await temporary(t);
  const sourceRoot = path.join(root, 'download cache');
  const installDir = path.join(root, 'installed runtime');
  await fs.mkdir(path.join(sourceRoot, 'src'), { recursive: true });
  await fs.writeFile(path.join(sourceRoot, 'package.json'), '{"name":"fixture","version":"1.0.0"}');
  await fs.writeFile(path.join(sourceRoot, 'src', 'cli.js'), '// version 1');
  const initial = await runtimeLocation(sourceRoot, installDir);
  assert.equal(initial.entry, (await runtimeLocation(sourceRoot, installDir)).entry);
  assert.ok(initial.entry.startsWith(installDir));
  assert.ok(!initial.entry.startsWith(sourceRoot));
  await fs.writeFile(path.join(sourceRoot, 'src', 'cli.js'), '// version 2');
  assert.notEqual(initial.entry, (await runtimeLocation(sourceRoot, installDir)).entry);
  assert.equal(defaultInstallDir({ homeDir: root, platform: 'linux', env: {} }), path.join(root, '.local', 'share', 'automatic-ai-prompt'));
  assert.ok((await findNpmCli()).endsWith('npm-cli.js'));
});
