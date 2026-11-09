import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { modify, applyEdits, parse as parseJsonc, parseTree } from 'jsonc-parser';
import { parseTOML, getStaticTOMLValue } from 'toml-eslint-parser';

export const SERVER_KEY = 'intent-bridge';
const BEGIN = '<!-- automatic-ai-prompt:begin -->';
const END = '<!-- automatic-ai-prompt:end -->';
export { BEGIN as INSTRUCTIONS_BEGIN, END as INSTRUCTIONS_END };
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const prefix = (a, b) => a.length <= b.length && a.every((key, i) => key === b[i]);
const keys = (node) => node.keys.map((key) => key.name ?? key.value);

function tomlValue(value) {
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(', ')}]`;
  if (record(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))) return `{ ${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)} = ${tomlValue(item)}`).join(', ')} }`;
  throw new Error('기존 MCP 설정에 자동 갱신할 수 없는 값이 있습니다. 원본은 변경하지 않았습니다.');
}

export function readServerSettings(source, format, rootKey = format === 'toml' ? 'mcp_servers' : 'mcpServers') {
  if (source === null) return undefined;
  let data;
  if (format === 'toml') data = getStaticTOMLValue(parseTOML(source.replace(/^\uFEFF/, '')));
  else {
    const errors = [];
    data = parseJsonc(source.replace(/^\uFEFF/, ''), errors, { allowTrailingComma: format === 'jsonc', disallowComments: format === 'json' });
    if (errors.length || !record(data)) throw new Error('JSON 설정을 읽을 수 없습니다.');
  }
  return data[rootKey]?.[SERVER_KEY];
}

export function updateJson(source, connection, { rootKey = 'mcpServers', strict = false } = {}) {
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
  const body = source.slice(bom.length) || '{}';
  const errors = [];
  const ast = parseTree(body, errors, { allowTrailingComma: !strict, disallowComments: strict });
  const current = parseJsonc(body);
  if (errors.length || !record(current)) throw new Error('설정 파일의 JSON 형식이 올바르지 않습니다. 원본은 변경하지 않았습니다.');
  const checkDuplicates = (node) => {
    if (node.type === 'object') {
      const names = node.children.map((child) => child.children[0].value);
      if (new Set(names).size !== names.length) throw new Error('중복된 JSON 키가 있어 설정을 자동 수정할 수 없습니다.');
    }
    for (const child of node.children ?? []) checkDuplicates(child);
  };
  checkDuplicates(ast);
  if (current[rootKey] !== undefined && !record(current[rootKey])) throw new Error(`${rootKey} 항목이 객체가 아닙니다.`);
  if (JSON.stringify(current[rootKey]?.[SERVER_KEY]) === JSON.stringify(connection)) return source;
  const edits = modify(body, [rootKey, SERVER_KEY], connection, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: body.includes('\r\n') ? '\r\n' : '\n' },
  });
  return bom + applyEdits(body, edits);
}

export function removeJsonServer(source, { rootKey = 'mcpServers', strict = false } = {}) {
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
  const body = source.slice(bom.length);
  const current = parseJsonc(body);
  // Reuse the full validator, including duplicate-key and container checks.
  updateJson(source, current?.[rootKey]?.[SERVER_KEY], { rootKey, strict });
  if (!current?.[rootKey] || !Object.hasOwn(current[rootKey], SERVER_KEY)) return source;
  return bom + applyEdits(body, modify(body, [rootKey, SERVER_KEY], undefined, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: body.includes('\r\n') ? '\r\n' : '\n' },
  }));
}

export function removeTomlServer(source) {
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
  const body = source.slice(bom.length);
  let ast;
  try { ast = parseTOML(body); } catch { throw new Error('Codex 설정의 TOML 형식이 올바르지 않습니다.'); }
  const current = getStaticTOMLValue(ast);
  if (!record(current.mcp_servers) || !Object.hasOwn(current.mcp_servers, SERVER_KEY)) return source;
  const target = ['mcp_servers', SERVER_KEY];
  const edits = [];
  const inlineRemovals = new Map();
  const erase = (node, parent) => {
    edits.push({ start: node.range[0], end: node.range[1] });
    if (!parent) return;
    if (!inlineRemovals.has(parent)) inlineRemovals.set(parent, new Set());
    inlineRemovals.get(parent).add(node);
  };
  const scan = (node, parentKeys, parent) => {
    const full = [...parentKeys, ...keys(node.key)];
    if (prefix(target, full)) erase(node, parent);
    else if (prefix(full, target) && node.value.type === 'TOMLInlineTable') {
      for (const child of node.value.body) scan(child, full, node.value);
    }
  };
  for (const node of ast.body[0].body) {
    if (node.type === 'TOMLKeyValue') scan(node, [], null);
    else if (node.type === 'TOMLTable') {
      if (prefix(target, node.resolvedKey)) edits.push({ start: node.range[0], end: node.range[1] });
      else for (const child of node.body) scan(child, node.resolvedKey, null);
    }
  }
  for (const [parent, removed] of inlineRemovals) {
    let keptBefore = false;
    for (let i = 0; i < parent.body.length; i++) {
      const node = parent.body[i];
      if (!removed.has(node)) keptBefore = true;
      const next = parent.body[i + 1];
      const keepSeparator = Boolean(next && !removed.has(next) && keptBefore);
      for (const token of ast.tokens) {
        if (token.value === ',' && token.range[0] >= node.range[1] && token.range[1] <= (next?.range[0] ?? parent.range[1] - 1) && !keepSeparator) {
          edits.push({ start: token.range[0], end: token.range[1] });
        }
      }
    }
  }
  let output = body;
  for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + output.slice(edit.end);
  let verified;
  try { verified = getStaticTOMLValue(parseTOML(output)); } catch { throw new Error('Codex 연결을 안전하게 제거하지 못했습니다.'); }
  if (Object.hasOwn(verified.mcp_servers ?? {}, SERVER_KEY)) throw new Error('Codex 연결을 안전하게 제거하지 못했습니다.');
  return bom + output;
}

export function removeInstructions(source) {
  const start = source.indexOf(BEGIN);
  const end = source.indexOf(END);
  if (start < 0 && end < 0) return source;
  if (start < 0 || end < start || source.indexOf(BEGIN, start + BEGIN.length) >= 0 || source.indexOf(END, end + END.length) >= 0) {
    throw new Error('자동 적용 지침의 구분자가 손상되어 제거를 중단했습니다.');
  }
  return source.slice(0, start) + source.slice(end + END.length);
}

// Use TOML syntax ranges, so a fake section header inside a multiline string
// cannot be mistaken for a real table. Unrelated text and comments stay intact.
export function updateToml(source, connection) {
  const bom = source.startsWith('\uFEFF') ? '\uFEFF' : '';
  const body = source.slice(bom.length);
  let ast;
  try { ast = parseTOML(body); } catch { throw new Error('Codex 설정의 TOML 형식이 올바르지 않습니다. 원본은 변경하지 않았습니다.'); }
  const current = getStaticTOMLValue(ast);
  if (current.mcp_servers !== undefined && !record(current.mcp_servers)) throw new Error('mcp_servers 항목이 객체가 아닙니다.');
  if (JSON.stringify(current.mcp_servers?.[SERVER_KEY]) === JSON.stringify(connection)) return source;
  const target = ['mcp_servers', SERVER_KEY];
  const changes = [];
  let exactValue;
  let inlineParent;
  const scan = (node, parentKeys) => {
    const full = [...parentKeys, ...keys(node.key)];
    if (full.length === target.length && prefix(target, full)) {
      exactValue = node.value;
    } else if (prefix(target, full)) {
      changes.push({ start: node.range[0], end: node.range[1], text: '' });
    } else if (prefix(full, target) && node.value.type === 'TOMLInlineTable') {
      if (full.length === 1) inlineParent = node.value;
      for (const child of node.value.body) scan(child, full);
    }
  };
  for (const node of ast.body[0].body) {
    if (node.type === 'TOMLKeyValue') scan(node, []);
    else if (node.type === 'TOMLTable') {
      if (prefix(target, node.resolvedKey)) changes.push({ start: node.range[0], end: node.range[1], text: '' });
      else for (const child of node.body) scan(child, node.resolvedKey);
    }
  }
  const inline = tomlValue(connection);
  if (exactValue) changes.push({ start: exactValue.range[0], end: exactValue.range[1], text: inline });
  else if (inlineParent) {
    const last = inlineParent.body.at(-1);
    const trailingComma = last && ast.tokens.some((token) => token.value === ',' && token.range[0] >= last.range[1] && token.range[1] < inlineParent.range[1]);
    changes.push({ start: inlineParent.range[1] - 1, end: inlineParent.range[1] - 1, text: `${last ? trailingComma ? ' ' : ', ' : ''}${JSON.stringify(SERVER_KEY)} = ${inline} ` });
  }
  let output = body;
  for (const change of changes.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, change.start) + change.text + output.slice(change.end);
  }
  if (!exactValue && !inlineParent) {
    const eol = body.includes('\r\n') ? '\r\n' : '\n';
    output += `${output.endsWith('\n') || !output ? '' : eol}${eol}[mcp_servers.${JSON.stringify(SERVER_KEY)}]${eol}${Object.entries(connection).map(([key, value]) => `${JSON.stringify(key)} = ${tomlValue(value)}`).join(eol)}${eol}`;
  }
  let verified;
  try { verified = getStaticTOMLValue(parseTOML(output)); }
  catch { throw new Error('Codex 설정을 안전하게 갱신하지 못했습니다.'); }
  if (JSON.stringify(verified.mcp_servers?.[SERVER_KEY]) !== JSON.stringify(connection)) throw new Error('Codex 설정을 안전하게 갱신하지 못했습니다.');
  return bom + output;
}

export function updateInstructions(source, instructions, frontmatter = '') {
  const block = `${BEGIN}\n${instructions.trim()}\n${END}`;
  const start = source.indexOf(BEGIN);
  const end = source.indexOf(END);
  if ((start === -1) !== (end === -1) || (start >= 0 && (end < start || source.indexOf(BEGIN, start + BEGIN.length) >= 0 || source.indexOf(END, end + END.length) >= 0))) {
    throw new Error('기존 자동 적용 지침의 구분자가 손상되어 자동 갱신을 중단했습니다.');
  }
  if (start >= 0) return source.slice(0, start) + block + source.slice(end + END.length);
  return `${source || frontmatter}${source && !source.endsWith('\n') ? '\n' : ''}${source ? '\n' : ''}${block}\n`;
}

export const CLIENTS = [
  { id: 'codex', label: 'Codex — 사용자 전체', format: 'toml' },
  { id: 'claude_code', label: 'Claude Code — 사용자 전체', format: 'json' },
  { id: 'gemini_cli', label: 'Gemini CLI — 사용자 전체', format: 'json' },
  { id: 'cursor', label: 'Cursor — 현재 프로젝트', format: 'jsonc' },
  { id: 'vscode', label: 'VS Code / GitHub Copilot — 현재 프로젝트', format: 'jsonc' },
  { id: 'claude_desktop', label: 'Claude Desktop — MCP 연결', format: 'json' },
];

export function selectClients(values, platform = process.platform) {
  const aliases = { claude: 'claude_code', gemini: 'gemini_cli' };
  const result = [...new Set(values.flatMap((value) => value.split(',')).map((value) => aliases[value.trim()] ?? value.trim()).filter(Boolean))];
  if (!result.length || result.some((id) => !CLIENTS.some((client) => client.id === id))) throw new Error('연결할 AI를 올바르게 선택해 주세요.');
  if (platform === 'linux' && result.includes('claude_desktop')) throw new Error('Claude Desktop 자동 설정은 Windows와 macOS를 지원합니다.');
  return result;
}

export function clientFiles(id, { homeDir, projectDir, platform, env = {}, isolated = false }) {
  const codexDir = !isolated && env.CODEX_HOME ? env.CODEX_HOME : path.join(homeDir, '.codex');
  const claudeDir = !isolated && env.CLAUDE_CONFIG_DIR ? env.CLAUDE_CONFIG_DIR : path.join(homeDir, '.claude');
  switch (id) {
    case 'codex': return { config: path.join(codexDir, 'config.toml'), rules: path.join(codexDir, 'AGENTS.md') };
    case 'claude_code': return { config: !isolated && env.CLAUDE_CONFIG_DIR ? path.join(claudeDir, '.claude.json') : path.join(homeDir, '.claude.json'), rules: path.join(claudeDir, 'CLAUDE.md') };
    case 'gemini_cli': return { config: path.join(homeDir, '.gemini', 'settings.json'), rules: path.join(homeDir, '.gemini', 'GEMINI.md') };
    case 'cursor': return { config: path.join(projectDir, '.cursor', 'mcp.json'), rules: path.join(projectDir, '.cursor', 'rules', 'intent-bridge.mdc'), frontmatter: '---\ndescription: Understand intent and complete rough requests\nalwaysApply: true\n---\n\n' };
    case 'vscode': return { config: path.join(projectDir, '.vscode', 'mcp.json'), rules: path.join(projectDir, '.github', 'instructions', 'intent-bridge.instructions.md'), frontmatter: '---\napplyTo: "**"\n---\n\n', rootKey: 'servers' };
    case 'claude_desktop': {
      const dir = platform === 'darwin' ? path.join(homeDir, 'Library', 'Application Support', 'Claude') : path.join(!isolated && env.APPDATA ? env.APPDATA : path.join(homeDir, 'AppData', 'Roaming'), 'Claude');
      return { config: path.join(dir, 'claude_desktop_config.json') };
    }
    default: throw new Error('지원하지 않는 AI입니다.');
  }
}

export async function snapshot(file) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`일반 파일이 아닌 설정은 자동 수정하지 않습니다: ${file}`);
    return { text: await fs.readFile(file, 'utf8'), mode: stat.mode & 0o777 };
  } catch (error) {
    if (error.code === 'ENOENT') return { text: null, mode: 0o600 };
    throw error;
  }
}

export async function buildSetupPlan({ clients, connections, homeDir, projectDir, platform, env, isolated, entry, node = process.execPath, instructions, withInstructions = true }) {
  const plan = [];
  for (const selection of connections ?? clients.map((id) => ({ client: id }))) {
    const id = selection.client;
    const client = CLIENTS.find((candidate) => candidate.id === id);
    const defaults = clientFiles(id, { homeDir, projectDir, platform, env, isolated });
    const files = selection.config ? { ...defaults, config: selection.config, rules: selection.rules ?? undefined } : defaults;
    if (id === 'codex' && files.rules) {
      const override = path.join(path.dirname(files.rules), 'AGENTS.override.md');
      if ((await snapshot(override)).text !== null) files.rules = override;
    }
    const original = await snapshot(files.config);
    const connection = { ...(selection.settings ?? {}), ...(id === 'vscode' ? { type: 'stdio' } : {}), command: node, args: [entry] };
    let content;
    try {
      content = client.format === 'toml' ? updateToml(original.text ?? '', connection) : updateJson(original.text ?? '', connection, { rootKey: files.rootKey, strict: client.format === 'json' });
    } catch (error) { throw new Error(`${files.config}: ${error.message}`); }
    const includeRules = Boolean(withInstructions && selection.withInstructions !== false && files.rules);
    plan.push({ client: id, file: files.config, before: original.text, mode: original.mode, after: content,
      connection: { client: id, config: files.config, rules: files.rules ?? null, withInstructions: Boolean((selection.withInstructions ?? withInstructions) && files.rules) } });
    if (includeRules) {
      const rules = await snapshot(files.rules);
      // Project-specific rule documents are owned files, unlike shared global instructions.
      if (files.frontmatter && rules.text !== null && !rules.text.includes(BEGIN)) throw new Error(`동일한 이름의 사용자 규칙 파일이 있습니다. 원본을 보존합니다: ${files.rules}`);
      plan.push({ client: id, file: files.rules, before: rules.text, mode: rules.mode, after: updateInstructions(rules.text ?? '', instructions, files.frontmatter) });
    }
  }
  return plan;
}

async function writeAtomic(file, text, mode) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.intent-bridge-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, text, { flag: 'wx', mode });
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}

export async function applySetupPlan(plan) {
  const changed = plan.filter((item) => item.before !== item.after);
  // Check every target before changing any file; never overwrite concurrent edits.
  for (const item of changed) if ((await snapshot(item.file)).text !== item.before) throw new Error(`설정이 변경되어 설치를 중단했습니다. 다시 실행하세요: ${item.file}`);
  const written = [];
  const backups = [];
  try {
    for (const item of changed) {
      if ((await snapshot(item.file)).text !== item.before) throw new Error(`설정이 변경되었습니다: ${item.file}`);
      if (item.before !== null) {
        const backup = `${item.file}.bak-${Date.now()}-${randomUUID().slice(0, 8)}`;
        await fs.writeFile(backup, item.before, { flag: 'wx', mode: item.mode });
        backups.push(backup);
      }
      if (item.after === null) await fs.unlink(item.file);
      else await writeAtomic(item.file, item.after, item.mode);
      written.push(item);
    }
    return { changed: written.map((item) => item.file), backups };
  } catch (error) {
    const unrestored = [];
    for (const item of written.reverse()) {
      try {
        if ((await snapshot(item.file)).text !== item.after) throw new Error('concurrent edit');
        if (item.before === null) await fs.unlink(item.file);
        else await writeAtomic(item.file, item.before, item.mode);
      } catch { unrestored.push(item.file); }
    }
    throw new Error(`${error.message}${unrestored.length ? ` 자동 복원하지 못한 파일: ${unrestored.join(', ')}. 백업 파일을 확인하세요.` : ' 적용한 설정은 원래 상태로 복원했습니다.'}`);
  }
}
