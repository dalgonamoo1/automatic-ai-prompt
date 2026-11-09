import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { CLIENTS, selectClients, buildSetupPlan, applySetupPlan } from './setup-config.js';
import { defaultInstallDir, runtimeLocation, installRuntime } from './setup-runtime.js';
import { loadConnectionState, connectionStateEdit, resolveUpdateConnections } from './setup-state.js';

const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
export const SETUP_HELP = `사용법: automatic-ai-prompt setup [옵션]

옵션 없이 실행하면 연결할 AI를 번호로 선택합니다. 여러 개 선택할 수 있습니다.
선택한 앱의 MCP 연결과 자동 사용 지침을 설정하고, 기존 파일은 변경 전에 백업합니다.

  --client <이름>       메뉴 없이 선택 (반복 또는 쉼표로 여러 개 지정)
  --project <경로>      Cursor / VS Code를 연결할 프로젝트 (기본: 현재 폴더)
  --dry-run             변경할 파일만 확인. 설치나 설정 변경 없음
  --no-instructions     자동 사용 지침을 제외하고 MCP만 연결
  --install-dir <경로>  서버를 보관할 영구 설치 경로
  --config-dir <경로>   기본 사용자 폴더 대신 사용할 설정 루트 (격리 설치용)
  --help                도움말

지원: codex, claude_code, gemini_cli, cursor, vscode, claude_desktop
예: automatic-ai-prompt setup --client codex --client claude_code`;

export const UPDATE_HELP = `사용법: automatic-ai-prompt update [옵션]

이전에 연결한 AI와 프로젝트를 찾아 현재 내려받은 버전으로 갱신합니다.
AI 선택 메뉴 없이 진행하며 기존 연결과 실행 지침 설정을 유지합니다.
제거되었거나 다른 서버로 바뀐 항목은 다시 만들지 않습니다.

  --client <이름>       지정한 AI만 업데이트 (반복 또는 쉼표로 여러 개 지정)
  --project <경로>      Cursor / VS Code 업데이트를 해당 프로젝트로 제한
  --dry-run             업데이트할 파일만 확인. 설치나 설정 변경 없음
  --install-dir <경로>  사용자 지정 설치 경로
  --config-dir <경로>   격리 설치의 사용자 설정 루트
  --no-instructions     이번 업데이트에서 실행 지침 갱신 제외
  --help                도움말

최신 버전은 GitHub 설치 명령의 끝에 setup 대신 update를 사용하세요.`;

export function parseSetupArgs(args) {
  const result = { clients: [], withInstructions: true, dryRun: false };
  const values = { '--client': 'clients', '--project': 'projectDir', '--install-dir': 'installDir', '--config-dir': 'configDir' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') result.help = true;
    else if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--no-instructions') result.withInstructions = false;
    else if (values[arg]) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} 뒤에 값을 입력하세요.`);
      if (arg === '--client') result.clients.push(value);
      else result[values[arg]] = path.resolve(value);
    } else throw new Error(`알 수 없는 옵션: ${arg}. setup --help를 확인하세요.`);
  }
  return result;
}

async function chooseClients(platform, input, output) {
  if (!input.isTTY || !output.isTTY) throw new Error('AI 선택 메뉴에는 터미널이 필요합니다. 자동 실행에서는 --client codex처럼 지정하세요.');
  const available = CLIENTS.filter((client) => platform !== 'linux' || client.id !== 'claude_desktop');
  output.write('\n연결할 AI를 선택하세요. 선택한 앱에 MCP 연결과 실행 지침을 추가합니다.\n');
  available.forEach((client, i) => output.write(`  ${i + 1}. ${client.label}\n`));
  output.write('  0. 취소\n\n');
  const rl = createInterface({ input, output });
  try {
    while (true) {
      const answer = (await rl.question('번호 입력 (여러 개: 1,2 / 전체: all): ')).trim();
      if (answer === '0' || !answer) return [];
      if (answer.toLowerCase() === 'all') return available.map((client) => client.id);
      const indices = answer.split(/[\s,]+/).map(Number);
      if (indices.length && indices.every((number) => Number.isInteger(number) && number >= 1 && number <= available.length)) return [...new Set(indices)].map((number) => available[number - 1].id);
      output.write('목록의 번호를 입력해 주세요.\n');
    }
  } finally { rl.close(); }
}

export async function runSetupCli(args, { input = process.stdin, output = process.stdout, errorOutput = process.stderr, env = process.env, platform = process.platform, operation = 'setup' } = {}) {
  try {
    const options = parseSetupArgs(args);
    const updating = operation === 'update';
    if (options.help) { output.write(`${updating ? UPDATE_HELP : SETUP_HELP}\n`); return 0; }
    const homeDir = options.configDir || os.homedir();
    const projectDir = options.projectDir || process.cwd();
    const installDir = options.installDir || defaultInstallDir({ homeDir, platform, env: options.configDir ? {} : env });
    const state = await loadConnectionState(installDir);
    let clients;
    let connections;
    if (updating) {
      const existing = await resolveUpdateConnections(state, { homeDir, projectDir, platform, env, isolated: Boolean(options.configDir), installDir, clients: options.clients, projectFilter: options.projectDir });
      connections = existing.connections;
      for (const file of existing.skipped) output.write(`건너뜀 (연결이 제거되었거나 바뀜): ${file}\n`);
      if (!connections.length) throw new Error('업데이트할 기존 연결이 없습니다. setup으로 먼저 설치하세요. 이전 버전의 프로젝트 연결은 해당 폴더에서 update를 실행하세요.');
      clients = [...new Set(connections.map((item) => item.client))];
    } else {
      const chosen = options.clients.length ? options.clients : await chooseClients(platform, input, output);
      if (!chosen.length) { output.write('설치를 취소했습니다.\n'); return 0; }
      clients = selectClients(chosen, platform);
    }
    const location = await runtimeLocation(sourceRoot, installDir);
    const instructions = await fs.readFile(path.join(sourceRoot, 'examples', 'standing-instructions.ko.md'), 'utf8');
    const plan = await buildSetupPlan({ clients, connections, homeDir, projectDir, platform, env, isolated: Boolean(options.configDir), entry: location.entry, instructions, withInstructions: options.withInstructions });
    const registry = connectionStateEdit(state, plan.filter((item) => item.connection).map((item) => item.connection));
    output.write(`\nAutomatic AI Prompt · ${updating ? '업데이트 대상' : '연결 대상'}: ${clients.join(', ')}\n`);
    for (const item of plan) output.write(`  ${item.before === item.after ? '유지' : '설정'}: ${item.file}\n`);
    if (clients.includes('claude_desktop')) output.write('  Claude Desktop은 MCP 서버가 제공하는 실행 지침을 사용합니다.\n');
    if (options.dryRun) { output.write('\n미리보기 완료. 파일을 변경하지 않았습니다.\n'); return 0; }
    output.write('\n서버 설치 및 MCP 연결 검사 중…\n');
    const runtime = await installRuntime({ sourceRoot, installDir, env, location });
    const applied = await applySetupPlan([...plan, registry]);
    const changed = applied.changed.filter((file) => file !== state.file);
    const backups = applied.backups.filter((file) => !file.startsWith(`${state.file}.bak-`));
    output.write(`MCP 초기화·도구 호출 검사 통과. ${changed.length}개 설정 파일을 적용했습니다.\n`);
    if (backups.length) output.write(`기존 파일 백업: ${backups.length}개 (.bak-* 파일)\n`);
    output.write('완료! 선택한 AI 앱을 완전히 종료한 뒤 다시 열어 주세요.\n');
    output.write('현재 채팅에 도구가 제공되고 실행 지침이 적용되면, 도구 이름 없이 작업을 맡겨도 먼저 사용합니다.\n');
    output.write(`서버 보관 위치: ${runtime.root}\n`);
    return 0;
  } catch (error) {
    errorOutput.write(`설정 실패: ${error.message}\n`);
    return 1;
  }
}
