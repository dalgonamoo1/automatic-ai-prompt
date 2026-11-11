# ChatGPT 플러그인 다시 만들기 · 0.7.0

[English](rebuild-plugin.en.md)

이 저장소의 전체 소스를 ZIP으로 보관하면 나중에 같은 기능을 다시 배포할 수 있습니다. ZIP은 설치 완료된 플러그인 파일이 아니라 **서버 소스와 빌드·연결 안내**입니다. 새로 만들 계정에서 배포와 Install / Connect를 완료해야 합니다.

## 다른 AI에게 그대로 전달하기

전체 소스 ZIP을 첨부하고 아래 문장을 함께 전달하세요.

```text
첨부한 Automatic AI Prompt 0.7.0 소스로 ChatGPT용 MCP 플러그인을 다시 만들어줘.

기존 동작과 테스트를 유지하고 src/chatgpt-worker.js를 scripts/build-chatgpt.mjs로 빌드해 줘. 기존 배포를 갱신한다면 그 Site의 ID와 공개 범위를 유지하고, 새 배포라면 내 계정에 새 비공개 Site를 만들어 실제 반환받은 project_id와 capabilities: ["mcp"]를 사용해 줘. 다른 사람의 Site ID나 플러그인 ID를 복사하지 마.

별도 모델 API나 API 키를 추가하지 마. 호스트 AI가 작업 전에 intent의 목적·결과물·완료 기준·인용 사실·가정·필수 질문과 실제 execution_prompt를 작성해 refine_prompt에 전달하도록 하고, 문안 누락·공백은 거절해야 해. 질문이 필요하면 needs_clarification 초안을 기록하고 답변 후 이전 prompt_record.id에 연결한 새 개정을 ready로 기록해야 해. 이전 프롬프트를 보여 달라는 요청에는 도구 결과 원문을 인용하고 나중에 재구성한 문안을 원문이라고 주장하면 안 돼. 서버에 대화를 영구 저장하지 마.

npm ci --ignore-scripts, npm run check, npm test, npm run build:chatgpt를 확인한 뒤 정확히 그 소스와 빌드 결과를 배포해 줘. Sites가 생성한 기존 플러그인 연결을 활용하고 Install / Connect와 새 채팅에서의 확인 방법을 알려줘. 모든 채팅에서 자동 호출된다고 보장하지 마. 공개 배포나 다른 사용자 초대는 내가 요청할 때만 진행해 줘.
```

## 직접 빌드하기

Node.js 22.13 이상인 22 LTS 또는 24 이상과 npm이 필요합니다. 소스 압축을 푼 폴더에서 실행합니다.

```bash
npm ci --ignore-scripts
npm run check
npm test
npm run build:chatgpt
```

출력 파일은 `dist/server/index.js`입니다. Sites 배포용 체크아웃에는 해당 계정의 실제 Site ID를 사용한 `.openai/hosting.json`이 필요합니다.

```json
{
  "project_id": "Sites가 반환한 본인 Site ID",
  "capabilities": ["mcp"]
}
```

다시 빌드하면 배포용 매니페스트도 생성됩니다. 같은 소스를 Site의 소스 저장소에 푸시하고 빌드 결과를 배포하세요. 배포 파일에는 루트 `.openai/hosting.json`과 `dist/server/index.js`가 포함되어야 합니다. [전체 배포 안내](advanced.md#chatgpt용-worker-배포)를 참고하세요.

배포 후 생성된 **Automatic AI Prompt**를 ChatGPT의 **Plugins → Personal → Created by you**에서 Install / Connect한 뒤 새 채팅에서 선택합니다. 기존 Site를 재배포하면 해당 플러그인의 도구도 갱신됩니다. 공개 GitHub 저장소에만 코드를 올리는 것으로 배포 서버가 자동 갱신되지는 않습니다.

## 중요한 파일

- [ChatGPT 서버](../src/chatgpt-worker.js): `/mcp`, `/health`, 연결 안내 페이지
- [프롬프트 계약](../src/prompt.js): 필수 문안, 초안·확정 상태, 원문·개정 기록
- [도구 설명](../src/tool-definition.js): AI가 작업 요청에서 자동 사용하도록 하는 안내
- [빌드 스크립트](../scripts/build-chatgpt.mjs): Worker 단일 파일 빌드
- [한국어 실행 지침](../examples/standing-instructions.ko.md) · [영어 실행 지침](../examples/standing-instructions.en.md)
- `package.json`, `package-lock.json`, `test/`: 의존성과 회귀 검증

## 다른 사람에게 공유하기

소스는 MIT 라이선스로 공유할 수 있습니다. 이 공개 저장소의 코드는 계정별 배포 ID, 비밀키, 사용자 대화 기록을 포함하지 않습니다. 개인 설치 설정·토큰·실제 도구 호출 기록은 별도로 ZIP에 넣지 마세요.

**2026년 11월 10일 공식 안내 기준:** 개인·Pro 계정은 Sites에서 만든 플러그인을 초대나 링크로 다른 ChatGPT 사용자에게 직접 공유할 수 없습니다. Business·Enterprise 워크스페이스는 플러그인 공유 권한과 Site 접근 권한을 갖춘 동료에게 공유할 수 있으며, 동료마다 설치와 연결을 완료해야 합니다. Site 링크나 Site 공개 설정만으로 플러그인이 공유되지는 않습니다.

개인 사용자끼리는 이 소스를 전달해 각자 자기 계정에서 배포할 수 있습니다. 공용 서비스로 제공하려면 별도 원격 HTTPS MCP 서버와 각 사용자의 ChatGPT 연결 방식을 마련해야 하며, 이용 가능 여부는 계정·요금제·관리자 설정에 따라 달라집니다.

[공식 Sites 플러그인 공유 안내](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites)
