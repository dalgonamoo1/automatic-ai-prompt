import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { getStaticTOMLValue, parseTOML } from 'toml-eslint-parser';
import { buildSetupPlan, applySetupPlan, readServerSettings, updateToml } from '../src/setup-config.js';
import { loadConnectionState, connectionStateEdit, resolveUpdateConnections, isManagedServer } from '../src/setup-state.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aip update '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const installDir = path.join(root, 'server files');
  return {
    root, homeDir: path.join(root, 'user profile'), projectDir: path.join(root, 'project A'),
    platform: process.platform, isolated: true, env: {}, installDir,
    entry: path.join(installDir, 'runtimes', 'a'.repeat(20), 'src', 'cli.js'),
    instructions: 'Clarify intent, ask only if needed, then execute.',
  };
}

async function seed(options, { legacy = false } = {}) {
  const state = await loadConnectionState(options.installDir);
  const plan = await buildSetupPlan(options);
  const record = connectionStateEdit(state, plan.filter((item) => item.connection).map((item) => item.connection));
  await applySetupPlan(legacy ? plan : [...plan, record]);
  return plan;
}

test('updates reuse saved apps across projects, preserve custom settings, and keep instruction preferences', async (t) => {
  const options = await fixture(t);
  const initial = await seed({ ...options, clients: ['codex', 'cursor'] });
  const projectB = path.join(options.root, 'project B');
  await seed({ ...options, projectDir: projectB, clients: ['cursor'], withInstructions: false });
  const codexFile = initial.find((item) => item.client === 'codex' && item.connection).file;
  let content = await fs.readFile(codexFile, 'utf8');
  const settings = readServerSettings(content, 'toml');
  content = updateToml(content, { ...settings, enabled: false, startup_timeout_sec: 45, env: { AIP_TEST_VALUE: 'keep this value' } });
  await fs.writeFile(codexFile, content);
  const state = await loadConnectionState(options.installDir);
  assert.equal(state.connections.length, 3);
  const resolved = await resolveUpdateConnections(state, { ...options, projectDir: path.join(options.root, 'unrelated directory'), clients: [] });
  assert.equal(resolved.connections.length, 3);
  const newEntry = path.join(options.installDir, 'runtimes', 'b'.repeat(20), 'src', 'cli.js');
  const plan = await buildSetupPlan({ ...options, connections: resolved.connections, entry: newEntry, instructions: 'Updated workflow' });
  assert.ok(!plan.some((item) => item.file === path.join(projectB, '.cursor', 'rules', 'intent-bridge.mdc')));
  await applySetupPlan([...plan, connectionStateEdit(state, plan.filter((item) => item.connection).map((item) => item.connection))]);
  const updated = getStaticTOMLValue(parseTOML(await fs.readFile(codexFile, 'utf8'))).mcp_servers['intent-bridge'];
  assert.deepEqual(updated.args, [newEntry]);
  assert.equal(updated.enabled, false);
  assert.equal(updated.startup_timeout_sec, 45);
  assert.deepEqual(updated.env, { AIP_TEST_VALUE: 'keep this value' });
  for (const project of [options.projectDir, projectB]) {
    const config = JSON.parse(await fs.readFile(path.join(project, '.cursor', 'mcp.json'), 'utf8'));
    assert.deepEqual(config.mcpServers['intent-bridge'].args, [newEntry]);
  }
  const saved = await loadConnectionState(options.installDir);
  assert.equal(saved.connections.length, 3);
  assert.equal(saved.connections.find((item) => item.config.startsWith(projectB)).withInstructions, false);
  assert.ok(!saved.original.text.includes('AIP_TEST_VALUE'), 'The connection catalog must not copy environment values or secrets');
});

test('update skips removed or replaced registrations rather than restoring them', async (t) => {
  const options = await fixture(t);
  const plan = await seed({ ...options, clients: ['codex', 'cursor', 'gemini_cli'] });
  const cursor = plan.find((item) => item.client === 'cursor' && item.connection).file;
  const gemini = plan.find((item) => item.client === 'gemini_cli' && item.connection).file;
  await fs.writeFile(cursor, '{"mcpServers": {"other": {"command": "other"}}}');
  await fs.writeFile(gemini, '{"mcpServers": {"intent-bridge": {"command": "another-server", "args": []}}}');
  const result = await resolveUpdateConnections(await loadConnectionState(options.installDir), { ...options, clients: [] });
  assert.deepEqual(result.connections.map((item) => item.client), ['codex']);
  assert.deepEqual(new Set(result.skipped), new Set([cursor, gemini]));
  assert.ok((await fs.readFile(cursor, 'utf8')).includes('other'));
  assert.ok((await fs.readFile(gemini, 'utf8')).includes('another-server'));
});

test('legacy 0.2 installations are discovered and remain discoverable after a selective update', async (t) => {
  const options = await fixture(t);
  await seed({ ...options, clients: ['codex', 'cursor'] }, { legacy: true });
  let state = await loadConnectionState(options.installDir);
  assert.equal(state.exists, false);
  const selected = await resolveUpdateConnections(state, { ...options, clients: ['codex'] });
  assert.deepEqual(selected.connections.map((item) => item.client), ['codex']);
  await applySetupPlan([connectionStateEdit(state, selected.connections)]);
  state = await loadConnectionState(options.installDir);
  const all = await resolveUpdateConnections(state, { ...options, clients: [] });
  assert.deepEqual(new Set(all.connections.map((item) => item.client)), new Set(['codex', 'cursor']));
  assert.ok(all.connections.every((item) => item.withInstructions));
  assert.equal(isManagedServer({ args: ['/unrelated/src/cli.js'] }, options.installDir), false);
});

test('update dry-run uses saved projects without a selection menu or changing files', async (t) => {
  const options = await fixture(t);
  await seed({ ...options, clients: ['codex', 'cursor'] });
  const before = await fs.readFile(path.join(options.installDir, 'connections.json'), 'utf8');
  const result = spawnSync(process.execPath, [cli, 'update', '--dry-run', '--config-dir', options.homeDir, '--install-dir', options.installDir], { cwd: options.root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /업데이트 대상/);
  assert.match(result.stdout, /project A/);
  assert.ok(!result.stdout.includes('번호 입력'));
  assert.equal(await fs.readFile(path.join(options.installDir, 'connections.json'), 'utf8'), before);
  await assert.rejects(fs.access(path.join(options.installDir, 'runtimes')));
});

test('a first-time update does not turn into an installation', async (t) => {
  const options = await fixture(t);
  const result = spawnSync(process.execPath, [cli, 'update', '--dry-run', '--config-dir', options.homeDir, '--install-dir', options.installDir], { cwd: options.root, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /먼저 설치/);
  await assert.rejects(fs.access(options.installDir));
  await assert.rejects(fs.access(options.homeDir));
});

test('client and project filters keep unrelated saved connections unchanged', async (t) => {
  const options = await fixture(t);
  await seed({ ...options, clients: ['codex', 'cursor', 'vscode'] });
  const projectB = path.join(options.root, 'project B');
  await seed({ ...options, clients: ['cursor'], projectDir: projectB });
  const state = await loadConnectionState(options.installDir);
  const clientOnly = await resolveUpdateConnections(state, { ...options, clients: ['codex'] });
  assert.deepEqual(clientOnly.connections.map((item) => item.client), ['codex']);
  const projectOnly = await resolveUpdateConnections(state, { ...options, clients: [], projectFilter: projectB });
  assert.deepEqual(new Set(projectOnly.connections.map((item) => item.client)), new Set(['codex', 'cursor']));
  assert.ok(projectOnly.connections.find((item) => item.client === 'cursor').config.startsWith(projectB));
});

test('corrupt connection records are rejected without modifying them', async (t) => {
  const options = await fixture(t);
  await fs.mkdir(options.installDir, { recursive: true });
  const file = path.join(options.installDir, 'connections.json');
  for (const text of ['{bad-json', 'null', '{"version":2,"connections":[]}', '{"version":1,"connections":[null]}']) {
    await fs.writeFile(file, text);
    await assert.rejects(loadConnectionState(options.installDir));
    assert.equal(await fs.readFile(file, 'utf8'), text);
  }
});
