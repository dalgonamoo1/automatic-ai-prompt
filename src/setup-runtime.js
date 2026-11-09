import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export function defaultInstallDir({ homeDir = os.homedir(), platform = process.platform, env = process.env } = {}) {
  return platform === 'win32'
    ? path.join(env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local'), 'automatic-ai-prompt')
    : path.join(env.XDG_DATA_HOME || path.join(homeDir, '.local', 'share'), 'automatic-ai-prompt');
}

export async function findNpmCli(env = process.env, node = process.execPath) {
  const candidates = [];
  if (env.npm_execpath) candidates.push(path.join(path.dirname(env.npm_execpath), 'npm-cli.js'));
  candidates.push(path.join(path.dirname(node), 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  candidates.push(path.resolve(path.dirname(node), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  for (const directory of (env.PATH || env.Path || '').split(path.delimiter)) {
    for (const name of ['npm', 'npm.cmd']) {
      try {
        const resolved = await fs.realpath(path.join(directory, name));
        if (resolved.endsWith('npm-cli.js')) candidates.push(resolved);
        candidates.push(path.join(path.dirname(resolved), 'node_modules', 'npm', 'bin', 'npm-cli.js'));
      } catch { /* Try the next installed npm location. */ }
    }
  }
  for (const candidate of candidates) {
    try { if ((await fs.stat(candidate)).isFile()) return candidate; } catch { /* Continue discovery. */ }
  }
  throw new Error('npm 실행 파일을 찾지 못했습니다. Node.js와 npm이 설치된 터미널에서 다시 실행하세요.');
}

async function sourceFiles(sourceRoot) {
  const files = [];
  const visit = async (relative) => {
    const stat = await fs.lstat(path.join(sourceRoot, relative));
    if (stat.isSymbolicLink()) throw new Error('설치 원본에 심볼릭 링크가 있습니다. 공식 저장소의 패키지를 사용하세요.');
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(path.join(sourceRoot, relative))).sort()) await visit(path.join(relative, name));
    } else if (stat.isFile()) files.push(relative);
  };
  for (const name of ['package.json', 'package-lock.json', 'src', 'scripts', 'examples', 'README.md', 'LICENSE']) {
    try { await visit(name); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return files.sort();
}

export async function runtimeLocation(sourceRoot, installDir) {
  const files = await sourceFiles(sourceRoot);
  const hash = createHash('sha256');
  for (const file of files) { hash.update(file.replaceAll('\\', '/')); hash.update('\0'); hash.update(await fs.readFile(path.join(sourceRoot, file))); hash.update('\0'); }
  const digest = hash.digest('hex');
  const root = path.join(installDir, 'runtimes', digest.slice(0, 20));
  return { root, entry: path.join(root, 'src', 'cli.js'), digest, files };
}

function runNpm(npmCli, args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    // Execute npm's JS entry directly: paths with spaces work on Windows too,
    // and no config values or command arguments pass through a shell.
    const child = spawn(process.execPath, [npmCli, ...args], { cwd, env, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('의존성 설치 시간이 초과되었습니다. 네트워크를 확인하고 다시 실행하세요.')); }, 240000);
    child.once('error', () => { clearTimeout(timeout); reject(new Error('npm을 실행하지 못했습니다.')); });
    child.once('exit', (code) => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error('의존성 설치에 실패했습니다. npm 네트워크·인증 설정을 확인하세요. AI 설정은 변경하지 않았습니다.')); });
  });
}

export async function verifyRuntime(entry, { command = process.execPath, env } = {}) {
  const client = new Client({ name: 'automatic-ai-prompt-setup', version: '0.5.0' });
  const transport = new StdioClientTransport({ command, args: [entry], ...(env ? { env } : {}), stderr: 'pipe' });
  transport.stderr?.resume();
  let timeout;
  try {
    return await Promise.race([
      (async () => {
        await client.connect(transport);
        const tools = await client.listTools();
        if (!tools.tools.some((tool) => tool.name === 'refine_prompt')) throw new Error('Required tool unavailable');
        const executionPrompt = '설치 진단 요청에 정상적으로 응답하고 MCP 도구 호출이 가능한지 확인한다.';
        const result = await client.callTool({ name: 'refine_prompt', arguments: { request: '설치 상태 확인', execution_prompt: executionPrompt } });
        if (result.isError || result.structuredContent?.workflow?.final_output !== 'task_result' || result.structuredContent?.prompt_record?.text !== executionPrompt) throw new Error('Unexpected workflow');
        return { server: client.getServerVersion(), tools: tools.tools.map((tool) => tool.name) };
      })(),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('MCP timeout')), 15000); }),
    ]);
  } catch { throw new Error('설치된 서버의 MCP 연결 검사에 실패했습니다. AI 설정은 변경하지 않았습니다.'); }
  finally { clearTimeout(timeout); await client.close().catch(() => {}); await transport.close().catch(() => {}); }
}

export async function installRuntime({ sourceRoot, installDir, env = process.env, location }) {
  const runtime = location ?? await runtimeLocation(sourceRoot, installDir);
  const manifestPath = path.join(runtime.root, '.automatic-ai-prompt.json');
  let existing;
  try { existing = JSON.parse(await fs.readFile(manifestPath, 'utf8')); } catch { /* A new managed runtime is needed. */ }
  if (existing?.digest === runtime.digest) {
    await verifyRuntime(runtime.entry);
    return runtime;
  }
  try { await fs.lstat(runtime.root); throw new Error(`설치 경로에 관리되지 않는 파일이 있습니다: ${runtime.root}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.mkdir(path.dirname(runtime.root), { recursive: true });
  const stage = await fs.mkdtemp(path.join(path.dirname(runtime.root), '.install-'));
  try {
    for (const file of runtime.files) {
      const target = path.join(stage, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(path.join(sourceRoot, file), target);
    }
    const hasLock = runtime.files.includes('package-lock.json');
    const npmCli = await findNpmCli(env);
    await runNpm(npmCli, [hasLock ? 'ci' : 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: stage, env });
    await verifyRuntime(path.join(stage, 'src', 'cli.js'));
    await fs.writeFile(path.join(stage, '.automatic-ai-prompt.json'), JSON.stringify({ digest: runtime.digest, version: '0.5.0' }), { mode: 0o600 });
    await fs.rename(stage, runtime.root);
    return runtime;
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}
