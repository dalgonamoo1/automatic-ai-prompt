import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CLIENTS, SERVER_KEY, clientFiles, snapshot, readServerSettings, updateJson, removeJsonServer, removeTomlServer, removeInstructions, applySetupPlan, selectClients, INSTRUCTIONS_BEGIN, INSTRUCTIONS_END } from './setup-config.js';
import { loadConnectionState, connectionStateEdit, isManagedServer } from './setup-state.js';
import { parseSetupArgs } from './setup-cli.js';
import { defaultInstallDir, verifyRuntime } from './setup-runtime.js';

const key = (file) => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
const labels = { registered: '등록됨', missing: '연결 없음', replaced: '다른 서버로 변경됨', invalid: '설정 확인 필요' };

function blockStatus(text) {
  if (text === null) return 'absent';
  if (!text.includes(INSTRUCTIONS_BEGIN) && !text.includes(INSTRUCTIONS_END)) return 'unmanaged';
  try { removeInstructions(text); return 'present'; } catch { return 'invalid'; }
}

function rulePaths(record) {
  const paths = record.rules ? [record.rules] : [];
  if (record.client === 'codex') paths.push(...['AGENTS.md', 'AGENTS.override.md'].map((name) => path.join(path.dirname(record.config), name)));
  if (record.client === 'cursor') paths.push(path.join(path.dirname(record.config), 'rules', 'intent-bridge.mdc'));
  if (record.client === 'vscode') paths.push(path.join(path.dirname(path.dirname(record.config)), '.github', 'instructions', 'intent-bridge.instructions.md'));
  if (record.client === 'gemini_cli') paths.push(path.join(path.dirname(record.config), 'GEMINI.md'));
  return [...new Map(paths.map((file) => [key(file), file])).values()];
}

async function inspectConnection(record, options) {
  const client = CLIENTS.find((item) => item.id === record.client);
  const row = { record, managed: false, status: 'missing', config: null, settings: undefined, rules: [], mentioned: false };
  try {
    row.config = await snapshot(record.config);
    row.settings = readServerSettings(row.config.text, client.format, client.id === 'vscode' ? 'servers' : undefined);
    if (row.config.text !== null && client.format !== 'toml') updateJson(row.config.text, row.settings, { rootKey: client.id === 'vscode' ? 'servers' : 'mcpServers', strict: client.format === 'json' });
    row.managed = isManagedServer(row.settings, options.installDir);
    row.status = row.managed ? 'registered' : row.settings === undefined ? 'missing' : 'replaced';
  } catch {
    row.status = 'invalid';
    row.mentioned = Boolean(row.config?.text?.includes(SERVER_KEY));
    row.message = 'MCP 설정을 읽을 수 없습니다.';
  }
  for (const file of rulePaths(record)) {
    try {
      const original = await snapshot(file);
      row.rules.push({ file, ...original, status: blockStatus(original.text) });
    } catch { row.rules.push({ file, text: null, status: 'invalid' }); }
  }
  const override = record.client === 'codex' ? row.rules.find((item) => item.file.endsWith('AGENTS.override.md') && item.text !== null) : null;
  const active = override ?? row.rules.find((item) => record.rules && key(item.file) === key(record.rules)) ?? row.rules[0];
  row.rulesStatus = active?.status ?? 'absent';
  row.rulesHealthy = row.rulesStatus !== 'invalid' && (!record.withInstructions || row.rulesStatus === 'present');
  row.disabled = row.settings?.enabled === false || row.settings?.disabled === true;
  return row;
}

export async function connectionInventory(options) {
  const state = await loadConnectionState(options.installDir);
  const selected = options.clients.length ? selectClients(options.clients, options.platform) : [];
  const catalog = new Map(state.connections.map((item) => [key(item.config), { record: item, tracked: true }]));
  for (const client of CLIENTS) {
    if (client.id === 'claude_desktop' && options.platform === 'linux') continue;
    const files = clientFiles(client.id, options);
    if (!catalog.has(key(files.config))) catalog.set(key(files.config), { record: {
      client: client.id, config: files.config, rules: files.rules ?? null, withInstructions: false,
    }, tracked: false });
  }
  const all = [];
  for (const item of catalog.values()) {
    const row = await inspectConnection(item.record, options);
    const marked = row.rules.some((rule) => rule.status === 'present' || rule.status === 'invalid' && rule.text !== null);
    if (!item.tracked && !row.managed && !marked && !row.mentioned) continue;
    if (!item.tracked) row.record = { ...row.record, withInstructions: marked };
    row.rulesHealthy = row.rulesStatus !== 'invalid' && (!row.record.withInstructions || row.rulesStatus === 'present');
    all.push(row);
  }
  const rows = all.filter((row) => {
    if (selected.length && !selected.includes(row.record.client)) return false;
    if (options.projectFilter) return ['cursor', 'vscode'].includes(row.record.client) && key(path.dirname(path.dirname(row.record.config))) === key(options.projectFilter);
    return true;
  });
  return { state, all, rows };
}

function publicConnection(row) {
  return {
    client: row.record.client, status: row.status, config: row.record.config,
    runtime: row.managed ? row.settings.args[0] : null, disabled: row.disabled,
    instructions: row.rulesStatus, instructionsExpected: row.record.withInstructions,
    ruleFiles: row.rules.filter((item) => item.text !== null || item.status === 'invalid').map((item) => ({ path: item.file, status: item.status })),
    ...(row.message ? { message: row.message } : {}),
  };
}

export async function diagnoseConnections(rows, { probe = verifyRuntime } = {}) {
  const probes = new Map();
  const connections = [];
  for (const row of rows) {
    const result = { ...publicConnection(row), healthy: false, checks: { registration: row.managed, instructions: row.rulesHealthy, mcp: false } };
    if (!row.managed) result.message = row.message ?? '유효한 관리 대상 MCP 연결이 없습니다.';
    else if (row.disabled) result.message = '연결이 비활성화되어 있습니다. AI 앱에서 활성화하세요.';
    else {
      const settings = row.settings;
      const command = settings.command;
      try {
        if (typeof command !== 'string' || !path.isAbsolute(command) || !['node', 'node.exe', 'nodejs'].includes(path.basename(command).toLowerCase())) throw new Error('invalid node command');
        if (settings.env !== undefined && (!settings.env || typeof settings.env !== 'object' || Array.isArray(settings.env) || Object.values(settings.env).some((value) => typeof value !== 'string'))) throw new Error('invalid environment');
        await fs.access(command);
        const identity = JSON.stringify({ command, args: settings.args, env: settings.env });
        if (!probes.has(identity)) probes.set(identity, Promise.resolve().then(() => probe(settings.args[0], { command, env: settings.env })));
        const response = await probes.get(identity);
        result.checks.mcp = true;
        result.server = response?.server;
        result.tools = response?.tools;
        result.healthy = row.rulesHealthy;
        if (!row.rulesHealthy) result.message = '실행 지침이 없거나 손상되었습니다. update로 복구하세요.';
      } catch { result.message = '설정된 Node.js로 MCP 서버를 실행하거나 도구를 호출하지 못했습니다. update로 연결을 갱신하세요.'; }
    }
    connections.push(result);
  }
  return { command: 'doctor', healthy: connections.length > 0 && connections.every((row) => row.healthy), connections };
}

export async function buildUninstallPlan(inventory, options) {
  const plan = new Map();
  const add = (item) => {
    const existing = plan.get(key(item.file));
    if (existing && (existing.before !== item.before || existing.after !== item.after)) throw new Error(`겹치는 설정 경로를 안전하게 제거할 수 없습니다: ${item.file}`);
    plan.set(key(item.file), item);
  };
  for (const row of inventory.rows) {
    if (row.status === 'invalid') throw new Error(`설정 형식을 먼저 확인하세요. 원본은 변경하지 않았습니다: ${row.record.config}`);
    const client = CLIENTS.find((item) => item.id === row.record.client);
    const defaults = clientFiles(client.id, options);
    if (row.managed) {
      const after = client.format === 'toml' ? removeTomlServer(row.config.text) : removeJsonServer(row.config.text, { rootKey: defaults.rootKey, strict: client.format === 'json' });
      add({ file: row.record.config, before: row.config.text, mode: row.config.mode, after });
    }
    for (const rule of row.rules) {
      if (rule.status === 'invalid') throw new Error(`실행 지침을 안전하게 제거할 수 없습니다: ${rule.file}`);
      if (rule.status !== 'present') continue;
      const remaining = removeInstructions(rule.text);
      const after = defaults.frontmatter && remaining.trim() === defaults.frontmatter.trim() ? null : remaining;
      add({ file: rule.file, before: rule.text, mode: rule.mode, after });
    }
  }
  if (inventory.rows.length) add(connectionStateEdit(inventory.state, inventory.all.map((row) => row.record), inventory.rows.map((row) => row.record.config)));
  return [...plan.values()];
}

function managementHelp(operation) {
  const descriptions = {
    list: '등록된 AI와 프로젝트, 설정 파일 위치를 확인합니다. 서버를 실행하거나 설정을 변경하지 않습니다.',
    doctor: '등록 상태, 관리 지침, 설정된 Node.js를 통한 MCP 초기화와 도구 호출을 검사합니다. 설정을 변경하지 않습니다.',
    uninstall: '이 도구의 MCP 항목과 표시된 관리 지침만 제거합니다. 다른 설정과 사용자 지침은 보존하며 수정 전 백업합니다. 서버 파일과 백업은 보관합니다.',
  };
  return `사용법: automatic-ai-prompt ${operation} [옵션]\n\n${descriptions[operation]}\n\n  --client <이름>       지정한 AI만 선택 (반복 또는 쉼표로 여러 개 지정)\n  --project <경로>      해당 프로젝트의 Cursor / VS Code 연결만 선택\n  --install-dir <경로>  사용자 지정 설치 경로\n  --config-dir <경로>   격리 설치의 사용자 설정 루트\n  --json                JSON으로 결과 출력\n${operation === 'uninstall' ? '  --dry-run             제거할 파일만 미리 확인\n' : ''}  --help                도움말`;
}

export async function runManagementCli(operation, args, { output = process.stdout, errorOutput = process.stderr, env = process.env, platform = process.platform, probe = verifyRuntime } = {}) {
  const json = args.includes('--json');
  try {
    if (!['list', 'doctor', 'uninstall'].includes(operation)) throw new Error('지원하지 않는 관리 명령입니다.');
    const options = parseSetupArgs(args.filter((arg) => arg !== '--json'));
    if (options.help) { output.write(`${managementHelp(operation)}\n`); return 0; }
    if (!options.withInstructions || options.dryRun && operation !== 'uninstall') throw new Error('지원하지 않는 옵션입니다. --help를 확인하세요.');
    const homeDir = options.configDir || os.homedir();
    const context = { homeDir, projectDir: options.projectDir || process.cwd(), projectFilter: options.projectDir,
      platform, env, isolated: Boolean(options.configDir), clients: options.clients,
      installDir: options.installDir || defaultInstallDir({ homeDir, platform, env: options.configDir ? {} : env }) };
    const inventory = await connectionInventory(context);
    let result;
    let code = 0;
    if (operation === 'list') result = { command: 'list', connections: inventory.rows.map(publicConnection) };
    else if (operation === 'doctor') {
      result = await diagnoseConnections(inventory.rows, { probe });
      code = result.healthy ? 0 : 1;
    } else {
      const plan = await buildUninstallPlan(inventory, context);
      const affected = plan.filter((item) => item.before !== item.after);
      const applied = options.dryRun ? null : await applySetupPlan(plan);
      result = { command: 'uninstall', dryRun: options.dryRun, connections: inventory.rows.map(publicConnection),
        changed: affected.map((item) => item.file), backups: applied?.backups ?? [] };
    }
    if (json) output.write(`${JSON.stringify(result, null, 2)}\n`);
    else {
      if (!result.connections.length) output.write('등록된 연결이 없습니다. setup으로 연결할 AI를 선택하세요.\n');
      for (const row of result.connections) {
        const label = operation === 'doctor' ? row.healthy ? '정상' : '점검 필요' : labels[row.status];
        output.write(`${row.client}: ${label}\n  설정: ${row.config}\n`);
        if (row.message) output.write(`  ${row.message}\n`);
      }
      if (operation === 'doctor') output.write(`진단 범위: MCP 등록 · 서버 응답 · 관리 지침. 결과: ${result.healthy ? '정상' : '점검 필요'}\n`);
      if (operation === 'uninstall') {
        output.write(options.dryRun ? `미리보기: ${result.changed.length}개 파일이 변경됩니다. 아직 제거하지 않았습니다.\n` : `연결 해제 완료. 변경 파일 ${result.changed.length}개, 백업 ${result.backups.length}개. AI 앱을 재시작하세요.\n`);
        output.write('서버 파일과 백업은 보관합니다.\n');
      }
    }
    return code;
  } catch (error) {
    if (json) output.write(`${JSON.stringify({ command: operation, error: error.message, ...(operation === 'doctor' ? { healthy: false } : {}) })}\n`);
    else errorOutput.write(`명령 실행 실패: ${error.message}\n`);
    return 1;
  }
}
