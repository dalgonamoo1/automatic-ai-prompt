import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { CLIENTS, selectClients, buildSetupPlan, applySetupPlan } from './setup-config.js';
import { defaultInstallDir, runtimeLocation, installRuntime } from './setup-runtime.js';

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

export async function runSetupCli(args, { input = process.stdin, output = process.stdout, errorOutput = process.stderr, env = process.env, platform = process.platform } = {}) {
  try {
    const options = parseSetupArgs(args);
    if (options.help) { output.write(`${SETUP_HELP}\n`); return 0; }
    const chosen = options.clients.length ? options.clients : await chooseClients(platform, input, output);
    if (!chosen.length) { output.write('설치를 취소했습니다.\n'); return 0; }
    const clients = selectClients(chosen, platform);
    const homeDir = options.configDir || os.homedir();
    const projectDir = options.projectDir || process.cwd();
    const installDir = options.installDir || defaultInstallDir({ homeDir, platform, env: options.configDir ? {} : env });
    const location = await runtimeLocation(sourceRoot, installDir);
    const instructions = await fs.readFile(path.join(sourceRoot, 'examples', 'standing-instructions.ko.md'), 'utf8');
    const plan = await buildSetupPlan({ clients, homeDir, projectDir, platform, env, isolated: Boolean(options.configDir), entry: location.entry, instructions, withInstructions: options.withInstructions });
    output.write(`\nAutomatic AI Prompt · 연결 대상: ${clients.join(', ')}\n`);
    for (const item of plan) output.write(`  ${item.before === item.after ? '유지' : '설정'}: ${item.file}\n`);
    if (clients.includes('claude_desktop')) output.write('  Claude Desktop은 MCP 서버가 제공하는 실행 지침을 사용합니다.\n');
    if (options.dryRun) { output.write('\n미리보기 완료. 파일을 변경하지 않았습니다.\n'); return 0; }
    output.write('\n서버 설치 및 MCP 연결 검사 중…\n');
    const runtime = await installRuntime({ sourceRoot, installDir, env, location });
    const applied = await applySetupPlan(plan);
    output.write(`MCP 초기화·도구 호출 검사 통과. ${applied.changed.length}개 설정 파일을 적용했습니다.\n`);
    if (applied.backups.length) output.write(`기존 파일 백업: ${applied.backups.length}개 (.bak-* 파일)\n`);
    output.write('완료! 선택한 AI 앱을 완전히 종료한 뒤 다시 열어 주세요.\n');
    output.write('이제 평소처럼 요청하면 의도 정리 → 필요한 질문 → 작업 수행 흐름을 사용합니다.\n');
    output.write(`서버 보관 위치: ${runtime.root}\n`);
    return 0;
  } catch (error) {
    errorOutput.write(`설정 실패: ${error.message}\n`);
    return 1;
  }
}
