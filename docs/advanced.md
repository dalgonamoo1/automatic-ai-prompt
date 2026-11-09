# 상세 설정 · 개발자 안내

**한국어** · [English](advanced.en.md)

[← 설치와 사용 방법으로 돌아가기](../README.md)

설정 파일 위치, 수동 연결, 원격 배포, MCP 인터페이스를 확인할 때 읽어 주세요. 일반적인 설치는 README의 한 줄 명령으로 끝납니다.

## 자동 설치의 연결 범위

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

`setup`은 새로 연결할 AI를 선택하는 설치 명령입니다. 기존 연결을 갱신할 때는 별도의 `update` 명령을 사용하세요.

```bash
npx -y --prefer-online git+https://github.com/dalgonamoo1/automatic-ai-prompt.git update
```

업데이트는 설치 폴더의 `connections.json`에 기록한 AI와 프로젝트를 찾아 갱신합니다. 선택 메뉴는 다시 열지 않으며, 기존 서버 옵션과 실행 지침 포함 여부를 유지합니다. 사용자가 제거했거나 다른 서버로 바꾼 연결은 다시 만들지 않습니다. 기존 실행 지침은 중복 추가하지 않고 관리되는 부분만 교체합니다.

0.2 버전처럼 연결 기록이 없는 설치는 사용자 설정과 현재 프로젝트에서 기존 연결을 찾습니다. 이전에 연결한 다른 프로젝트는 해당 폴더에서 한 번 `update`를 실행하면 이후 업데이트 대상에 포함됩니다. 사용자 지정 `--install-dir` 또는 `--config-dir`로 설치했다면 업데이트에도 같은 경로를 지정하세요.

이미 실행 중인 앱을 위해 이전 서버 버전은 자동 삭제하지 않습니다. 특정 Git 커밋에 고정하려면 Git URL 뒤에 `#커밋SHA`를 붙일 수 있습니다.

설정 변경 없이 대상 파일을 보려면:

```bash
npx -y git+https://github.com/dalgonamoo1/automatic-ai-prompt.git setup --client codex --dry-run
```

기존 연결의 업데이트만 미리 보려면:

```bash
npx -y --prefer-online git+https://github.com/dalgonamoo1/automatic-ai-prompt.git update --dry-run
```

추가 옵션: `--project 경로`, `--install-dir 경로`, `--no-instructions`. 자동화나 격리 설치에서는 `--config-dir 경로`로 기본 사용자 폴더 대신 별도 설정 루트를 지정할 수 있습니다. 자세한 옵션은 `setup --help`, `update --help`를 확인하세요.

이 설치 흐름은 [REA의 setup 방식](https://rea.tools/get-started/)처럼 한 명령에서 클라이언트를 선택하고 MCP와 워크플로 지침을 연결하는 방식입니다. 구현은 이 프로젝트용으로 작성했습니다.

## 연결 목록 · 진단 · 제거

세 명령은 이 프로젝트의 자동 설치기로 등록한 로컬 MCP 연결을 관리합니다. 저장된 연결 기록과 현재 프로젝트의 기존 설치를 확인합니다. `--client codex`처럼 특정 AI만 고를 수 있고, `--project 경로`를 지정하면 해당 프로젝트의 Cursor·VS Code 연결만 대상으로 합니다. 사용자 지정 설치 경로가 있다면 `--install-dir`, `--config-dir`도 함께 지정하세요.

### 연결 목록: `list`

등록된 AI와 프로젝트, 설정 파일 위치, 연결이 삭제되거나 다른 서버로 바뀌었는지 보여줍니다. 서버를 실행하거나 설정 파일을 변경하지 않습니다.

```bash
npx -y --prefer-online git+https://github.com/dalgonamoo1/automatic-ai-prompt.git list --json
```

### 연결 진단: `doctor`

등록된 서버 실행 경로와 관리 지침을 확인하고, 설정된 Node.js와 환경변수로 서버를 실행해 MCP 초기화·도구 호출을 검사합니다. 설정 파일은 변경하지 않으며 환경변수 값은 결과에 출력하지 않습니다. 비활성화된 연결은 실행하지 않고 상태를 알려줍니다.

```bash
npx -y --prefer-online git+https://github.com/dalgonamoo1/automatic-ai-prompt.git doctor --client codex --json
```

JSON의 `healthy`가 정상 여부를 나타냅니다. 모든 대상이 정상이면 종료 코드 0, 문제가 있거나 대상이 없으면 1입니다. 진단 범위는 등록 설정·MCP 서버 응답·관리 지침이며, AI 앱 안에서의 자동 호출이나 실제 작업 품질을 검증하는 것은 아닙니다.

### 연결 제거: `uninstall`

기본적으로 등록된 모든 연결에서 이 도구의 MCP 항목과 표시된 관리 지침 블록을 제거합니다. 다른 서버로 교체된 항목은 그대로 둡니다. 다른 MCP 서버, 사용자 문장, 규칙 파일에 추가한 사용자 내용은 보존합니다. 이 도구가 만든 프로젝트 규칙 파일에 사용자 내용이 없다면 해당 파일도 제거합니다.

실행 전 확인하려면:

```bash
npx -y --prefer-online git+https://github.com/dalgonamoo1/automatic-ai-prompt.git uninstall --dry-run
```

특정 AI만 제거하려면:

```bash
npx -y --prefer-online git+https://github.com/dalgonamoo1/automatic-ai-prompt.git uninstall --client codex
```

수정·삭제 전 파일은 백업하고, 적용 중 실패하면 이미 변경한 내용을 복원합니다. 실행 중인 서버와 복구를 위해 서버 파일·백업은 자동 삭제하지 않습니다. 완료 후 AI 앱을 재시작하세요. `list`, `doctor`, `uninstall` 모두 `--help`를 지원하며, `--json`으로 결과를 구조화해 받을 수 있습니다.

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

`setup`을 사용하면 지원되는 앱의 실행 지침까지 설치합니다. 수동 연결을 선택했다면 [자동 적용 지침](../examples/standing-instructions.ko.md)을 앱의 사용자 지침·프로젝트 규칙에 한 번 추가하세요. [영어 지침](../examples/standing-instructions.en.md)도 제공합니다. MCP 연결 자체가 모든 메시지를 가로채는 구조는 아닙니다.

자동 적용 지침을 추가한 뒤에는 원래 요청만 입력하면 됩니다.

기본 대상은 작성·수정·분석·요약·계획·개발 등 결과물을 만드는 작업입니다. 구체적인 요청과 작은 수정도 포함하고, "분석해 줄 수 있어?"처럼 질문 형태라도 작업 요청이면 적용합니다. 인사·잡담·단순 지식 질문은 제외합니다. 새 작업마다 한 번 사용하고, 같은 작업의 확인 질문에 대한 답변에는 재호출하지 않습니다. 도구가 없거나 실패하면 사용했다고 주장하지 않고 상태를 알리도록 안내합니다.

> 팀장님께 일정이 금요일에서 월요일로 미뤄진다고 메일 써줘. 검토가 더 필요해서이고, 핑계처럼 들리지 않았으면 좋겠어.

AI는 이미 제공된 일정과 사유를 반영해 내부 지침을 구체화하고, 실제 메일을 작성합니다. 이름처럼 자리표시자로 처리할 수 있는 정보 때문에 작업을 멈추지 않으며, 내용이나 정확성을 크게 바꿀 정보가 빠진 경우에만 질문합니다.

프롬프트 자체가 필요할 때는 명시하세요.

> 신입 개발자 포트폴리오 피드백을 요청할 프롬프트만 만들어줘.

각 앱에 한 번씩 연결해야 합니다. 한 앱의 MCP 설정이 다른 앱에 자동으로 공유되지는 않습니다. 호스트 AI가 도구와 지침을 따르는 정도에 따라 적용 여부와 결과가 달라집니다.

### 자동 사용 확인하기

1. 기존 설치는 `update`로 갱신하고 AI 앱을 완전히 재시작한 뒤 새 채팅을 엽니다. `--no-instructions`로 설치했던 연결은 업데이트도 그 선택을 유지합니다. 지침을 추가하려면 `setup`에서 해당 AI를 다시 선택하세요.
2. 현재 채팅에서 `intent-bridge` 서버의 `refine_prompt` 도구를 사용할 수 있는지 확인합니다. MCP 목록에 등록된 것만으로 현재 채팅에서 호출 가능한 것은 아닙니다.
3. 도구 이름 없이 "하루 30분씩 공부할 일주일 영어 계획 짜줘"라고 요청하고 앱의 도구 실행 기록에서 `refine_prompt` 호출을 확인합니다. 결과물만 나온 것으로 도구 호출을 판단하지 마세요.
4. 확인 질문에 답하면 다시 호출하거나 "실행해"라고 하지 않고 작업을 이어가는지 확인합니다. "광합성이 뭐야?" 같은 단순 지식 질문은 자동 호출 대상에서 제외됩니다.

`doctor`는 서버 연결을 진단하며 이 과정의 AI 판단까지 검사하지 않습니다. 자동 호출이 빠지면 실행 지침이 적용되었는지, 현재 채팅에 도구가 제공되는지 확인하세요. 앱에서 도구를 노출하지 않으면 지침만으로 활성화할 수 없습니다.

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
