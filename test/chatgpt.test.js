import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import worker from '../src/chatgpt-worker.js';

const url = 'https://prompt.example/mcp';
const rpc = (method, params = {}, id = 0) => worker.fetch(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) }));

test('ChatGPT Worker supports stateless discovery and actual SDK calls without a model API', async (t) => {
  const discovery = await (await rpc('server/discover')).json();
  assert.ok(discovery.result.supportedVersions.includes('2026-07-28'));
  assert.deepEqual(discovery.result.capabilities, { tools: {} });
  const client = new Client({ name: 'chatgpt-connection-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { fetch: (input, init) => worker.fetch(new Request(input, init)) }));
  const tools = await client.listTools();
  assert.equal(tools.tools[0].name, 'refine_prompt');
  assert.equal(tools.tools[0].annotations.readOnlyHint, true);
  assert.equal(tools.tools[0].inputSchema.properties.request.type, 'string');
  assert.ok(tools.tools[0].inputSchema.required.includes('execution_prompt'));
  const missing = await client.callTool({ name: 'refine_prompt', arguments: { request: '광합성 칩 개발하고 싶어' } });
  assert.equal(missing.isError, true);
  assert.equal(client.getServerVersion().version, '0.8.0');
  const result = await client.callTool({ name: 'refine_prompt', arguments: { request: '하루 30분 영어 공부 계획 짜줘', execution_prompt: '영어 회화 실력을 위한 일주일 계획을 하루 30분으로 작성한다. 듣기·발화·복습 시간을 배분하고 각 날의 완료 기준을 포함한다.', constraints: ['일주일', '회화 중심'], intent: { goal: '영어 회화 실력을 위한', deliverable: '일주일 계획', success_criteria: ['하루 30분', '각 날의 완료 기준'] }, coverage: [{ section: 'constraints', index: 1, prompt_quote: '영어 회화 실력을 위한' }] } });
  assert.equal(result.structuredContent.source.request, '하루 30분 영어 공부 계획 짜줘');
  assert.deepEqual(result.structuredContent.source.constraints, ['일주일', '회화 중심']);
  assert.equal(result.structuredContent.workflow.final_output, 'task_result');
  assert.equal(result.structuredContent.workflow.after_clarification, 'record_revision_then_execute');
  const promptOnly = await client.callTool({ name: 'refine_prompt', arguments: { request: '메일 작성을 요청할 프롬프트만 만들어줘', mode: 'prompt_only', execution_prompt: '주어진 수신자와 전달 목적에 맞춰 메일 제목과 본문을 작성해 줘.', intent: { goal: '주어진 수신자와 전달 목적', deliverable: '메일 제목과 본문', success_criteria: ['작성해 줘.'] } } });
  assert.equal(promptOnly.structuredContent.workflow.final_output, 'improved_prompt');
  assert.equal((await rpc('tools/call', { name: 'refine_prompt', arguments: { request: '새 요청', execution_prompt: '새 요청에 맞는 결과물을 작성한다.', intent: { goal: '새 요청에 맞는', deliverable: '결과물', success_criteria: ['작성한다.'] } } })).headers.get('mcp-session-id'), null);
});

test('ChatGPT Worker isolates concurrent requests and refuses invalid input without echoing it', async () => {
  const outputs = await Promise.all(['첫 요청', '둘째 요청'].map(async (request) => (await (await rpc('tools/call', { name: 'refine_prompt', arguments: { request, execution_prompt: `${request}에 맞는 결과물을 작성한다.`, intent: { goal: `${request}에 맞는`, deliverable: '결과물', success_criteria: ['작성한다.'] } } })).json()).result));
  assert.deepEqual(outputs.map(item => item.structuredContent.source.request), ['첫 요청', '둘째 요청']);
  const invalid = await rpc('tools/call', { name: 'refine_prompt', arguments: { request: '', secret: 'do-not-echo' } });
  const body = await invalid.text();
  assert.equal(JSON.parse(body).result.isError, true);
  assert.ok(!body.includes('do-not-echo'));
  assert.equal((await (await rpc('tools/call', { name: 'absent' })).json()).error.code, -32602);
  assert.equal((await (await rpc('absent')).json()).error.code, -32601);
  assert.equal((await (await rpc('tools/list', [])).json()).error.code, -32602);
});

test('ChatGPT Worker enforces request limits, content type, JSON-RPC framing and HTTP methods', async () => {
  assert.equal((await worker.fetch(new Request(url))).status, 405);
  assert.equal((await worker.fetch(new Request(url, { method: 'POST', body: '{}' }))).status, 415);
  const post = (body) => worker.fetch(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }));
  assert.equal((await post('{private-invalid')).status, 400);
  assert.equal((await post('[]')).status, 400);
  assert.equal((await post(JSON.stringify({ jsonrpc: '2.0', id: null, method: 'ping' }))).status, 400);
  assert.equal((await post('x'.repeat(131073))).status, 413);
  const notification = await post(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  assert.equal(notification.status, 202);
  assert.equal(await notification.text(), '');
  assert.equal((await worker.fetch(new Request('https://prompt.example/health'))).status, 200);
  assert.equal((await worker.fetch(new Request('https://prompt.example/unknown'))).status, 404);
});

test('ChatGPT regression: provisional and ready prompt documents remain exact and linked', async () => {
  const request = '광합성 가능한 반도체 칩을 개발하고 싶어';
  const initialText = '\n광합성의 의미를 먼저 확인하고 가능한 칩 개발 방향을 제안한다. 물질 생성 여부와 전력 생성 여부를 확인하기 전에는 생성물을 확정하지 않는다.\n';
  const first = (await (await rpc('tools/call', { name: 'refine_prompt', arguments: {
    request, execution_prompt: initialText, intent: { goal: '광합성의 의미를 먼저 확인', deliverable: '칩 개발 방향', success_criteria: ['생성물을 확정하지 않는다.'], unknowns: [{ question: '빛·물·CO₂를 화학물질로 바꾸는 것이 목표인가요?', why_it_matters: '목표 반응을 결정해야 한다.', blocking: true }] }, prompt_state: 'needs_clarification', questions: ['빛·물·CO₂를 화학물질로 바꾸는 것이 목표인가요?'],
  } })).json()).result;
  assert.equal(first.structuredContent.prompt_record.text, initialText);
  assert.equal(first.structuredContent.workflow.ready_for_host_execution, false);
  const updatedText = '빛·물·CO₂를 화학물질로 바꾸는 반도체 인공광합성 칩의 개발 방향을 제안한다. 확인된 연구 근거와 검증 순서를 포함하고 예산과 장비는 미정으로 표시한다.';
  const next = (await (await rpc('tools/call', { name: 'refine_prompt', arguments: {
    request, execution_prompt: updatedText, intent: { goal: '빛·물·CO₂를 화학물질로 바꾸는', deliverable: '개발 방향', success_criteria: ['예산과 장비는 미정으로 표시한다.'] }, revision: 2, previous_prompt_id: first.structuredContent.prompt_record.id,
    context: '사용자가 빛·물·CO₂로 화학물질을 만드는 목표라고 답함.',
  } })).json()).result;
  assert.equal(next.structuredContent.prompt_record.text, updatedText);
  assert.equal(next.structuredContent.prompt_record.previous_prompt_id, first.structuredContent.prompt_record.id);
  assert.equal(next.structuredContent.workflow.ready_for_host_execution, true);
  assert.equal(first.structuredContent.prompt_record.text, initialText);
  const blank = (await (await rpc('tools/call', { name: 'refine_prompt', arguments: { request, execution_prompt: '  ' } })).json()).result;
  assert.equal(blank.isError, true);
});
