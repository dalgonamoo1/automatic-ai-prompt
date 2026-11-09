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
  assert.equal(client.getServerVersion().version, '0.4.2');
  const result = await client.callTool({ name: 'refine_prompt', arguments: { request: '하루 30분 영어 공부 계획 짜줘', constraints: ['일주일', '회화 중심'] } });
  assert.equal(result.structuredContent.source.request, '하루 30분 영어 공부 계획 짜줘');
  assert.deepEqual(result.structuredContent.source.constraints, ['일주일', '회화 중심']);
  assert.equal(result.structuredContent.workflow.final_output, 'task_result');
  assert.equal(result.structuredContent.workflow.after_clarification, 'resume_task');
  const promptOnly = await client.callTool({ name: 'refine_prompt', arguments: { request: '메일 작성을 요청할 프롬프트만 만들어줘', mode: 'prompt_only' } });
  assert.equal(promptOnly.structuredContent.workflow.final_output, 'improved_prompt');
  assert.equal((await rpc('tools/call', { name: 'refine_prompt', arguments: { request: '새 요청' } })).headers.get('mcp-session-id'), null);
});

test('ChatGPT Worker isolates concurrent requests and refuses invalid input without echoing it', async () => {
  const outputs = await Promise.all(['첫 요청', '둘째 요청'].map(async (request) => (await (await rpc('tools/call', { name: 'refine_prompt', arguments: { request } })).json()).result));
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
