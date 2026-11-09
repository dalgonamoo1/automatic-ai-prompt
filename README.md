# Automatic AI Prompt

**요청은 짧게. AI는 의도를 구체화하고, 작업까지.**

이미 쓰는 AI에 MCP로 연결하면, AI가 요청의 목적과 조건을 정리하고 **내부 실행 프롬프트**를 만든 뒤 그 지침대로 작업합니다. 꼭 필요한 정보가 빠졌을 때만 질문합니다.

[작동 방식](#어떻게-작동하나요) · [설치하기](#설치하기) · [명령어](#자주-쓰는-명령어) · [상세 설정](docs/advanced.md)

## 어떻게 작동하나요?

![짧은 요청 → 의도 파악과 내부 프롬프트 작성 → 필요한 경우 질문과 답변 반영 → 작업 수행 → 결과 제공](docs/assets/workflow.svg)

1. **평소처럼 부탁합니다.** 원하는 일을 짧게 적습니다.
2. **AI가 의도를 구체화합니다.** 대화에서 이미 알려준 내용을 활용해 목적·조건·결과물·완성 기준을 담은 내부 프롬프트를 만듭니다.
3. **필요한 경우에만 질문합니다.** 결과를 크게 바꿀 정보가 빠졌을 때 확인하고, 답변을 내부 프롬프트에 반영합니다.
4. **작업을 수행하고 결과를 보여줍니다.** 중간 프롬프트를 승인하거나 다시 “실행해”라고 말할 필요가 없습니다.

이 과정은 **연결한 AI가 직접 수행**합니다. 별도 모델 API를 추가로 호출하지 않습니다.

### 실제로는 이렇게 사용해요

> **나:** 팀장님께 일정이 미뤄졌다고 메일 써줘.
>
> **AI:** 원래 일정과 변경된 일정, 변경 사유를 알려주세요.
>
> **나:** 금요일에서 월요일로. 검토가 더 필요해서야.

AI는 답변을 반영해 메일을 작성합니다. 예를 들면:

> **제목: 일정 변경 안내**
>
> 안녕하세요. 검토에 시간이 더 필요하여, 예정된 일정을 금요일에서 월요일로 변경하게 되었습니다. 양해 부탁드립니다.

기본 결과물은 **완성된 작업 결과**입니다. 프롬프트 자체가 필요할 때만 “프롬프트만 만들어줘”라고 요청하세요.

## 설치하기

### 1. 준비하기

**Node.js 22 LTS(22.13 이상) 또는 24 이상**, **npm**, **Git**, 연결할 AI 앱이 필요합니다. 저장소가 공개되어 있어 GitHub 로그인이나 토큰은 필요하지 않습니다.

Cursor나 VS Code에 연결하려면 **사용할 프로젝트 폴더에서** 터미널을 열어 주세요.

### 2. 아래 명령 실행하기

```bash
npx -y git+https://github.com/dalgonamoo1/automatic-ai-prompt.git setup
```

<details>
<summary>Windows PowerShell에서 npx가 차단된다면</summary>

`npx.cmd`로 실행하세요. 실행 정책을 바꿀 필요는 없습니다.

```powershell
npx.cmd -y git+https://github.com/dalgonamoo1/automatic-ai-prompt.git setup
```

</details>

### 3. 연결할 AI 선택하기

![AI 선택 메뉴 예시: 번호로 여러 앱 선택 → 서버 설치와 MCP 연결 검사 → MCP와 실행 지침 등록 → AI 앱 재시작](docs/assets/setup.svg)

번호를 입력하면 **서버 설치 → MCP 연결 검사 → 선택한 앱에 MCP·실행 지침 등록**까지 진행합니다.

- 하나만 선택: `1`
- 여러 개 선택: `1,2`
- 화면에 나온 앱 전체: `all`

Codex·Claude Code·Gemini CLI는 사용자 전체에, Cursor·VS Code는 현재 프로젝트에 설정합니다. Claude Desktop은 Windows와 macOS에서 지원하며, MCP 서버가 제공하는 실행 지침을 사용합니다.

### 4. AI 앱 재시작하기

선택한 앱을 **완전히 종료한 뒤 다시 열면** 됩니다. 이후에는 평소처럼 요청하세요. 매번 설치 명령을 실행할 필요가 없습니다.

앱에서 MCP 사용 승인이나 서버 신뢰를 요청하면 해당 앱에서 허용해 주세요.

## 자주 쓰는 명령어

**설치 · 업데이트** — 같은 명령을 다시 실행하면 연결과 실행 지침을 갱신합니다.

```bash
npx -y git+https://github.com/dalgonamoo1/automatic-ai-prompt.git setup
```

**연결할 AI 바로 지정** — 선택 메뉴를 생략합니다. 아래 예시는 Codex와 Claude Code를 함께 연결합니다.

```bash
npx -y git+https://github.com/dalgonamoo1/automatic-ai-prompt.git setup --client codex --client claude_code
```

**변경 전 미리보기** — 설치하거나 설정을 바꾸지 않고 대상 파일만 확인합니다.

```bash
npx -y git+https://github.com/dalgonamoo1/automatic-ai-prompt.git setup --client codex --dry-run
```

**전체 옵션 확인**

```bash
npx -y git+https://github.com/dalgonamoo1/automatic-ai-prompt.git setup --help
```

## 알아두기

- **기존 설정 보존:** 다른 MCP 항목은 유지하고, 수정 전 원본은 `.bak-*` 파일로 백업합니다. 다시 설치해도 실행 지침을 중복 추가하지 않습니다.
- **별도 API 키 불필요:** 추가 모델 호출은 없습니다. 사용하는 AI 앱의 구독·사용량 요금은 별도입니다.
- **앱별 동작 차이:** 도구의 자동 호출과 결과 품질은 연결한 AI 및 앱의 MCP 지원 방식에 따라 달라질 수 있습니다.
- **웹 앱 연결:** ChatGPT 웹처럼 서버 URL을 요구하는 앱은 별도 HTTPS 배포가 필요합니다. [원격 연결 방법](docs/advanced.md#url을-요구하는-앱에-연결)을 확인하세요.

설정 파일 위치, 수동 설치, 배포, 개발용 명령은 [상세 안내](docs/advanced.md)에 정리했습니다.

MIT License · [라이선스](LICENSE)
