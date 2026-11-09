# Automatic AI Prompt · Intent Bridge MCP

**대충 부탁하면, AI가 의도를 파악하고 내부 프롬프트를 구체화한 뒤 작업까지 수행합니다.**

이미 사용하는 AI가 요청을 이해하고, 목적·조건·결과물·완성 기준을 담은 실행 프롬프트를 내부적으로 작성한 다음, 그 지시에 따라 작업하도록 돕는 MCP 서버입니다. 필요한 경우에만 질문하고 답변을 반영해 작업을 이어갑니다. 별도 OpenAI·Claude API 키나 모델 API 호출이 없습니다. 연결한 앱의 구독·사용량 정책과 원격 서버의 호스팅 비용은 별도입니다.

```text
사용자: "이거 좀 더 설득력 있게 써줘"
          ↓
연결된 AI → refine_prompt(원래 요청, 이미 알려진 배경과 조건)
          ↓
Intent Bridge → 의도·조건을 보존하는 편집 자료와 지침 반환
          ↓
연결된 AI → 의도 파악 + 내부 실행 프롬프트 작성
          ↓
필요한 경우에만 질문 → 답변을 내부 프롬프트에 반영
          ↓
연결된 AI → 프롬프트대로 작업 수행 + 결과 확인
          ↓
사용자에게 실제 작업 결과 제공
```

MCP 서버는 실행 지침과 입력 자료를 제공하고, **연결된 AI가 의도 해석·내부 프롬프트 작성·실제 작업을 수행**합니다. 중간 프롬프트는 기본적으로 사용자에게 보여 주지 않습니다. 사용자가 프롬프트만 원한다고 명시하면 그때는 프롬프트를 결과물로 반환합니다. 의미를 전혀 알 수 없는 요청을 알아내거나 모든 AI의 결과 품질을 보장하지는 않습니다.

## 주요 기능

- 원래 목적, 대상, 말투, 명시한 조건을 유지합니다.
- 목적·배경·원하는 결과물·완성 기준을 작업에 맞게 구체화합니다.
- 없는 사실·예산·기술·날짜·기능을 마음대로 추가하지 않도록 안내합니다.
- 결과를 크게 바꿀 정보가 빠졌을 때만 최대 3개의 핵심 질문을 하도록 안내합니다.
- 간단한 요청은 짧게 다듬고, 복잡한 요청만 필요한 만큼 구체화합니다.
- 기본은 의도 정리 후 작업 수행입니다. 중간 프롬프트 승인이나 별도의 실행 요청을 기다리지 않습니다.
- 필수 질문에 답을 받으면 내부 프롬프트를 갱신하고 작업을 이어갑니다.
- 사용자가 프롬프트 자체를 원한다고 명시한 경우에만 프롬프트를 반환합니다.

## 한 명령으로 설치하고 AI 선택하기

Node.js **22 LTS(22.13 이상) 또는 24 이상**, npm, Git, 연결할 AI 앱이 준비되어 있다면 아래 명령 하나를 실행하세요.

```bash
npx -y git+https://github.com/dalgonamoo1/automatic-ai-prompt.git setup
```

Windows PowerShell에서 `npx` 실행이 차단되면 `npx.cmd`를 사용하면 됩니다. 실행 정책을 바꿀 필요는 없습니다.

```powershell
npx.cmd -y git+https://github.com/dalgonamoo1/automatic-ai-prompt.git setup
```

저장소가 공개되어 있어 GitHub 로그인이나 토큰 없이 설치할 수 있습니다. 패키지는 GitHub에서 받으며 npm 레지스트리에는 게시되어 있지 않습니다.

실행하면 연결할 AI를 고르는 메뉴가 나옵니다.

```text
연결할 AI를 선택하세요.
  1. Codex — 사용자 전체
  2. Claude Code — 사용자 전체
  3. Gemini CLI — 사용자 전체
  4. Cursor — 현재 프로젝트
  5. VS Code / GitHub Copilot — 현재 프로젝트
  6. Claude Desktop — MCP 연결

번호 입력 (여러 개: 1,2 / 전체: all):
```

Linux에서는 공식 Claude Desktop 자동 설정 항목이 표시되지 않습니다. 원하는 앱의 번호를 입력하면 다음을 자동으로 처리합니다.

1. 다운로드 캐시와 별개인 영구 폴더에 MCP 서버와 의존성을 설치합니다.
2. 실제 서버에 접속해 MCP 초기화와 `refine_prompt` 호출을 검사합니다.
3. 선택한 앱에 MCP를 등록하고 실행 지침을 추가합니다.
4. 완료 메시지가 나오면 선택한 AI 앱을 완전히 종료한 뒤 다시 엽니다.

기존 설정과 다른 MCP 항목은 유지합니다. 수정 전 원본은 같은 폴더의 `.bak-*` 파일로 백업하며, 재실행하면 이 도구의 등록 항목과 지침만 갱신합니다. 설정 중 실패하면 이미 적용한 변경을 복원합니다. 설치 후에는 매번 `npx`를 실행할 필요 없이 AI 앱을 평소처럼 사용하세요.

### 연결 범위

| 앱 | MCP 설정 | 실행 지침 |
| --- | --- | --- |
| Codex | `~/.codex/config.toml` | `~/.codex/AGENTS.md` (기존 override가 있으면 해당 파일) |
| Claude Code | `~/.claude.json` | `~/.claude/CLAUDE.md` |
| Gemini CLI | `~/.gemini/settings.json` | `~/.gemini/GEMINI.md` |
| Cursor | 현재 폴더의 `.cursor/mcp.json` | `.cursor/rules/intent-bridge.mdc` |
| VS Code | 현재 폴더의 `.vscode/mcp.json` | `.github/instructions/intent-bridge.instructions.md` |
| Claude Desktop | OS별 Claude 설정 파일 | MCP 서버가 제공하는 워크플로 지침 |

Cursor와 VS Code는 사용할 프로젝트 폴더에서 명령을 실행하세요. 다른 프로젝트는 해당 폴더에서 다시 연결할 수 있습니다. Claude Desktop에는 다른 CLI의 전역 지침 파일을 쓰지 않습니다. 각 클라이언트가 서버 지침과 도구를 적용하는 방식에 따라 자동 호출 여부가 달라질 수 있으며, 앱 자체가 요구하는 MCP 도구 사용 승인·신뢰 설정은 앱에서 처리합니다.

macOS/Linux 서버는 기본 `~/.local/share/automatic-ai-prompt`, Windows는 `%LOCALAPPDATA%/automatic-ai-prompt` 아래에 보관합니다. 설치 원본이나 npm 임시 캐시를 정리해도 등록된 서버 경로는 유지됩니다.

### 메뉴 없이 지정 / 업데이트 / 미리보기

여러 AI를 바로 지정할 수도 있습니다.

```bash
npx -y git+https://github.com/dalgonamoo1/automatic-ai-prompt.git setup --client codex --client claude_code
```

최신 코드로 연결을 갱신하려면 같은 명령을 다시 실행하세요. 기존 실행 지침은 중복 추가하지 않고 관리되는 부분만 교체합니다. 이미 실행 중인 앱을 위해 이전 서버 버전은 자동 삭제하지 않습니다. 특정 Git 커밋에 고정하려면 Git URL 뒤에 `#커밋SHA`를 붙일 수 있습니다.

설정 변경 없이 대상 파일을 보려면:

```bash
npx -y git+https://github.com/dalgonamoo1/automatic-ai-prompt.git setup --client codex --dry-run
```

추가 옵션: `--project 경로`, `--install-dir 경로`, `--no-instructions`. 자동화나 격리 설치에서는 `--config-dir 경로`로 기본 사용자 폴더 대신 별도 설정 루트를 지정할 수 있습니다. 자세한 옵션은 `setup --help`를 확인하세요.

이 설치 흐름은 [REA의 setup 방식](https://rea.tools/get-started/)처럼 한 명령에서 클라이언트를 선택하고 MCP와 워크플로 지침을 연결하는 방식입니다. 구현은 이 프로젝트용으로 작성했습니다.

## 수동 연결 / 개발용 설치

자동 설치 대신 직접 설정을 관리하고 싶을 때 사용하세요.

```bash
git clone https://github.com/dalgonamoo1/automatic-ai-prompt.git
cd automatic-ai-prompt
npm ci --ignore-scripts
```

GitHub CLI를 사용한다면 `gh repo clone dalgonamoo1/automatic-ai-prompt`로도 내려받을 수 있습니다.

앱에 맞는 설정을 출력합니다. **설정 내용을 화면에 보여 주기만** 하며 기존 설정을 수정하지 않습니다. 출력된 서버 항목을 기존 설정에 합치세요. 다른 서버 항목을 덮어쓰지 마세요.

| 앱 | 설정 출력 | 넣을 위치 |
| --- | --- | --- |
| Claude Desktop | `npm run --silent config -- claude` | 개발자 설정 → 로컬 MCP 설정의 `mcpServers` |
| Cursor | `npm run --silent config -- cursor` | MCP 설정의 `mcpServers` 또는 `.cursor/mcp.json` |
| VS Code | `npm run --silent config -- vscode` | 워크스페이스 `.vscode/mcp.json`의 `servers` |
| Codex | `npm run --silent config -- codex` | `~/.codex/config.toml`의 MCP 설정 |

실제 설치 위치와 Node 실행 경로가 들어간 설정을 생성하므로 경로를 직접 입력할 필요가 없습니다. 등록 후 앱의 연결을 다시 시작하고 `refine_prompt`가 표시되는지 확인하세요. 메뉴 이름과 MCP 지원 범위는 앱 버전에 따라 달라질 수 있습니다.

### 수동 설치 시 자동 적용

`setup`을 사용하면 지원되는 앱의 실행 지침까지 설치합니다. 수동 연결을 선택했다면 [자동 적용 지침](examples/standing-instructions.ko.md)을 앱의 사용자 지침·프로젝트 규칙에 한 번 추가하세요. [영어 지침](examples/standing-instructions.en.md)도 제공합니다. MCP 연결 자체가 모든 메시지를 가로채는 구조는 아닙니다.

자동 적용 지침을 추가한 뒤에는 원래 요청만 입력하면 됩니다.

> 팀장님께 일정이 금요일에서 월요일로 미뤄진다고 메일 써줘. 검토가 더 필요해서이고, 핑계처럼 들리지 않았으면 좋겠어.

AI는 이미 제공된 일정과 사유를 반영해 내부 지침을 구체화하고, 실제 메일을 작성합니다. 이름처럼 자리표시자로 처리할 수 있는 정보 때문에 작업을 멈추지 않으며, 내용이나 정확성을 크게 바꿀 정보가 빠진 경우에만 질문합니다.

프롬프트 자체가 필요할 때는 명시하세요.

> 신입 개발자 포트폴리오 피드백을 요청할 프롬프트만 만들어줘.

각 앱에 한 번씩 연결해야 합니다. 한 앱의 MCP 설정이 다른 앱에 자동으로 공유되지는 않습니다. 호스트 AI가 도구와 지침을 따르는 정도에 따라 적용 여부와 결과가 달라집니다.

### npx로 직접 연결하기 (수동)

설치기 대신 MCP 설정을 직접 관리하려면 로컬 클론 없이 아래 설정을 사용할 수 있습니다. 공개 GitHub 소스를 설치하는 방식이며, npm 레지스트리에 게시된 패키지라는 뜻은 아닙니다.

```json
{
  "mcpServers": {
    "intent-bridge": {
      "command": "npx",
      "args": [
        "--yes",
        "--package=git+https://github.com/dalgonamoo1/automatic-ai-prompt.git",
        "intent-bridge-mcp"
      ]
    }
  }
}
```

최초 실행에는 Git과 네트워크가 필요합니다. 검증된 버전을 고정하려면 Git URL 끝에 `#커밋SHA`를 붙이세요.

## URL을 요구하는 앱에 연결

로컬 `stdio` 대신 **Streamable HTTP**도 지원합니다. 원격 앱이 접근할 수 있는 HTTPS 서버에 배포한 뒤 `https://서버주소/mcp`를 등록하세요. ChatGPT 등 해당 앱에서 원격 MCP·사용자 지정 앱 추가 기능을 제공해야 하며 계정·요금제·관리자 설정에 따라 이용 가능 여부가 다릅니다. `localhost` 주소는 다른 서버에서 실행되는 AI 앱이 직접 접근할 수 없습니다.

```bash
npm run start:http
```

기본 주소는 `http://127.0.0.1:3000/mcp`, 상태 확인은 `/health`입니다. JSON 응답과 stateless MCP를 지원하며, 독립적인 SSE 스트림·세션 저장·구형 HTTP+SSE 전송은 제공하지 않습니다.

### Render 배포

Dockerfile과 `render.yaml`을 제공합니다. 비공개 저장소라면 Render에 저장소 읽기 권한이 필요합니다.

1. Render의 Blueprint 생성 화면에서 이 저장소를 선택합니다.
2. 서비스 생성 화면에서 요금제와 설정을 검토하고 배포합니다. 호스팅 이용 조건은 Render 정책을 따릅니다.
3. 발급된 도메인의 `/health`가 정상인지 확인합니다.
4. AI 앱에 `https://발급된도메인/mcp`를 등록합니다.

Render의 `RENDER_EXTERNAL_HOSTNAME`은 자동으로 허용됩니다. 무료 인스턴스의 절전·기동 지연은 MCP 연결에 영향을 줄 수 있습니다. **GitHub에 코드를 올리는 것만으로 서버가 호스팅되지는 않습니다.** 실제 원격 배포는 별도로 해야 합니다.

다른 호스팅에서는 다음 환경변수를 설정하세요.

| 변수 | 기본값 | 용도 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 컨테이너·외부 접속 시 `0.0.0.0` |
| `PORT` | `3000` | HTTP 포트 |
| `MCP_ALLOWED_HOSTS` | localhost 주소 + Render 제공 도메인 | 정확한 호스트명을 쉼표로 구분. 프로토콜·포트·와일드카드 제외 |
| `MCP_AUTH_TOKEN` | 미설정 | 선택: `/mcp`에 Bearer 토큰 인증 적용 |

`MCP_AUTH_TOKEN`은 호스팅 서비스의 비밀 환경변수로 설정하고 저장소에 넣지 마세요. 클라이언트가 사용자 지정 Authorization 헤더를 지원할 때 사용할 수 있습니다. OAuth 로그인 서버는 구현하지 않았으므로, OAuth를 필수로 요구하는 앱은 별도 인증 계층이 필요합니다. 공개 운영 시 HTTPS와 호스팅 서비스의 접속·요청 제한 설정을 사용하세요.

## MCP 인터페이스

### Tool: `refine_prompt`

```json
{
  "request": "경쟁사 분석 자료 만들고 싶음",
  "context": "우리 서비스는 한국 대학생을 위한 중고거래 앱",
  "constraints": ["확인되지 않은 수치 지어내지 않기"],
  "desired_output": "비교 표와 핵심 시사점",
  "language": "auto",
  "mode": "execute",
  "clarification": "minimal"
}
```

`request`만 필수입니다. 배경·조건·결과 형식은 이미 아는 정보가 있을 때만 전달합니다. 출력 언어는 기본 `auto`, 질문 방식은 기본 `minimal`이며 먼저 핵심 질문을 받고 싶으면 `ask_first`를 사용합니다.

`mode` 기본값은 `execute`입니다. AI가 내부 프롬프트를 작성한 뒤 원래 작업을 수행하고 결과를 보여 줍니다. 사용자가 프롬프트만 요청한 경우 호스트는 `prompt_only`를 선택해 프롬프트를 반환하고 그 안의 작업은 수행하지 않습니다. 사용자의 명시적인 프롬프트 전용 요청은 기본 모드보다 우선합니다.

입력 한도: 요청 12,000자, 배경 16,000자, 조건 최대 20개(각 2,000자), 결과 형식 4,000자. 한도를 넘으면 잘라내지 않고 오류를 반환합니다.

반환되는 `source`, `draft_prompt`, `rewrite_guidance`, `workflow`는 **호스트 AI용 작업 자료**입니다. 기본 `status: "host_execution_required"`는 연결된 AI가 내부 프롬프트를 구체화하고 작업까지 해야 한다는 뜻입니다. `prompt_only`에서는 `host_rewrite_required`를 반환합니다. 질문 필요 여부도 호스트 AI가 판단합니다. 필수 질문에 답을 받으면 호스트가 문맥을 갱신해 작업을 이어가며, 서버는 대화 상태를 저장하지 않습니다.

### Prompt: `refine`

MCP Prompts를 지원하는 앱에서 `request`, 선택 항목 `context`, `language`, `mode`를 전달할 수 있습니다. 기본은 의도 정리 후 작업 수행이며 `mode: "prompt_only"`일 때만 프롬프트를 반환합니다. Prompts UI가 없는 앱에서는 `refine_prompt` 도구를 사용하세요.

### Resource: `intent-bridge://guide`

의도 보존, 누락 정보 처리, 재작성 원칙을 제공합니다.

## 데이터 처리

- 서버 코드는 요청을 파일·데이터베이스에 저장하지 않습니다.
- 요청별 대화 메모리나 사용자 계정을 만들지 않습니다. 이전 대화는 호스트가 필요한 부분만 `context`로 전달합니다.
- 외부 모델 API 호출이나 분석·추적 코드를 포함하지 않습니다.
- 원격 HTTP에서는 입력이 선택한 서버로 전송되고 결과가 호스트 AI에 전달됩니다. AI 앱과 호스팅 제공자의 데이터 처리·로그 정책은 별도입니다.
- 입력은 JSON 데이터로 분리하고, 지침을 바꾸려는 입력을 무시하도록 호스트에 안내합니다. 이것이 모델의 프롬프트 인젝션 방어를 보장하지는 않습니다.

## 개발 및 검증

```bash
npm ci --ignore-scripts
npm run check
npm test
```

실제 MCP SDK 클라이언트로 stdio 자식 프로세스와 HTTP 서버에 접속해 초기화, 기본 실행·프롬프트 전용 모드 전달, 도구·프롬프트·리소스, 잘못된 입력, 동시 요청 간 데이터 분리, Host·Origin 검증, 선택적 인증, 본문 한도를 테스트합니다.

설치기는 별도 임시 폴더에서 여섯 클라이언트의 설정 생성, JSONC 주석과 다른 설정 보존, TOML 테이블·인라인·여러 줄 문자열 처리, 백업, 재설치 중복 방지, 중간 실패 복원, 동시 수정 감지, 미리보기의 무변경 동작을 검증합니다. CI는 Windows·macOS·Linux에서 Node 22와 24를 사용하도록 구성했습니다.

이 테스트는 프로토콜과 데이터 보존을 검증합니다. 다양한 AI 앱에서의 재작성 품질과 원격 호스팅 배포까지 검증한 것은 아닙니다. 품질은 호스트 모델과 제공한 맥락에 영향을 받습니다.

MIT License
