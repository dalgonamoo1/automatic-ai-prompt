import path from 'node:path';
import { CLIENTS, clientFiles, snapshot, readServerSettings, selectClients } from './setup-config.js';

const pathKey = (value) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);

export function connectionStatePath(installDir) {
  return path.join(installDir, 'connections.json');
}

export async function loadConnectionState(installDir) {
  const file = connectionStatePath(installDir);
  const original = await snapshot(file);
  if (original.text === null) return { file, original, connections: [], exists: false };
  let data;
  try { data = JSON.parse(original.text); } catch { throw new Error(`연결 기록을 읽을 수 없습니다: ${file}`); }
  if (!data || data.version !== 1 || !Array.isArray(data.connections)) throw new Error(`지원하지 않는 연결 기록입니다: ${file}`);
  for (const item of data.connections) {
    if (!item || !CLIENTS.some((client) => client.id === item.client) || typeof item.config !== 'string' || !path.isAbsolute(item.config) ||
        (item.rules !== null && (typeof item.rules !== 'string' || !path.isAbsolute(item.rules))) || typeof item.withInstructions !== 'boolean') {
      throw new Error(`연결 기록의 형식이 올바르지 않습니다: ${file}`);
    }
  }
  return { file, original, connections: data.connections, exists: true };
}

export function connectionStateEdit(state, added) {
  const records = new Map(state.connections.map((item) => [pathKey(item.config), item]));
  for (const item of added) records.set(pathKey(item.config), {
    client: item.client, config: item.config, rules: item.rules, withInstructions: item.withInstructions,
  });
  const connections = [...records.values()].sort((a, b) => a.config.localeCompare(b.config));
  return { file: state.file, before: state.original.text, mode: state.original.mode,
    after: `${JSON.stringify({ version: 1, connections }, null, 2)}\n` };
}

export function isManagedServer(settings, installDir) {
  if (!settings || !Array.isArray(settings.args) || settings.args.length !== 1 || typeof settings.args[0] !== 'string' || !path.isAbsolute(settings.args[0])) return false;
  const relative = path.relative(path.resolve(installDir, 'runtimes'), path.resolve(settings.args[0]));
  return /^[a-f0-9]{20}[/\\]src[/\\]cli\.js$/.test(relative);
}

// Releases before 0.3 did not save a connection catalog. Discover their entries
// in user settings and the current project without adopting unrelated servers.
export async function discoverConnections({ homeDir, projectDir, platform, env, isolated, installDir, clients }) {
  const found = [];
  for (const client of CLIENTS) {
    if ((platform === 'linux' && client.id === 'claude_desktop') || (clients?.length && !clients.includes(client.id))) continue;
    const files = clientFiles(client.id, { homeDir, projectDir, platform, env, isolated });
    const original = await snapshot(files.config);
    if (original.text === null) continue;
    let settings;
    try { settings = readServerSettings(original.text, client.format, client.id === 'vscode' ? 'servers' : undefined); }
    catch { throw new Error(`기존 AI 설정을 읽을 수 없습니다. 원본은 변경하지 않았습니다: ${files.config}`); }
    if (!isManagedServer(settings, installDir)) continue;
    let rules = files.rules ?? null;
    if (client.id === 'codex') {
      const override = path.join(path.dirname(files.config), 'AGENTS.override.md');
      if ((await snapshot(override)).text !== null) rules = override;
    }
    const text = rules ? (await snapshot(rules)).text : null;
    found.push({ client: client.id, config: files.config, rules, withInstructions: Boolean(text?.includes('<!-- automatic-ai-prompt:begin -->')) });
  }
  return found;
}

export async function resolveUpdateConnections(state, options) {
  const selected = options.clients.length ? selectClients(options.clients, options.platform) : [];
  const discovered = await discoverConnections({ ...options, clients: selected });
  const catalog = new Map(discovered.map((item) => [pathKey(item.config), item]));
  for (const item of state.connections) catalog.set(pathKey(item.config), item);
  const records = [...catalog.values()];
  const connections = [];
  const skipped = [];
  for (const item of records) {
    if (selected.length && !selected.includes(item.client)) continue;
    if (options.projectFilter && ['cursor', 'vscode'].includes(item.client) && pathKey(path.dirname(path.dirname(item.config))) !== pathKey(options.projectFilter)) continue;
    const format = CLIENTS.find((client) => client.id === item.client).format;
    let settings;
    try { settings = readServerSettings((await snapshot(item.config)).text, format, item.client === 'vscode' ? 'servers' : undefined); }
    catch { throw new Error(`기존 AI 설정을 읽을 수 없습니다. 원본은 변경하지 않았습니다: ${item.config}`); }
    if (!isManagedServer(settings, options.installDir)) { skipped.push(item.config); continue; }
    connections.push({ ...item, settings });
  }
  return { connections, skipped };
}
