import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { request as httpRequest } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpApp, readHttpConfig } from '../src/http.js';

async function assertMcpFeatures(client) {
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name), ['refine_prompt']);
  assert.equal(tools.tools[0].annotations.readOnlyHint, true);
  assert.match(client.getInstructions(), /rough requests/);

  const result = await client.callTool({ name: 'refine_prompt', arguments: {
    request: '신입 개발자 포트폴리오 피드백해줘',
    context: '취업 준비 중이며 프로젝트 2개가 있음', constraints: ['한국어'],
  } });
  assert.ok(!result.isError);
  assert.equal(result.structuredContent.source.request, '신입 개발자 포트폴리오 피드백해줘');
  assert.equal(result.structuredContent.status, 'host_execution_required');
  assert.equal(result.structuredContent.source.mode, 'execute');
  assert.equal(result.structuredContent.workflow.final_output, 'task_result');
  assert.equal(result.structuredContent.workflow.after_clarification, 'resume_task');
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);

  const promptOnly = await client.callTool({ name: 'refine_prompt', arguments: {
    request: '포트폴리오 피드백을 요청할 프롬프트만 만들어줘', mode: 'prompt_only',
  } });
  assert.ok(!promptOnly.isError);
  assert.equal(promptOnly.structuredContent.workflow.final_output, 'improved_prompt');
  assert.equal(promptOnly.structuredContent.workflow.prompt_visibility, 'user');

  const prompts = await client.listPrompts();
  assert.equal(prompts.prompts[0].name, 'refine');
  const prompt = await client.getPrompt({ name: 'refine', arguments: { request: 'Write a launch email', language: 'English' } });
  assert.equal(JSON.parse(prompt.messages[0].content.text).source.language, 'English');
  assert.equal(JSON.parse(prompt.messages[0].content.text).workflow.final_output, 'task_result');
  const promptOnlyTemplate = await client.getPrompt({ name: 'refine', arguments: {
    request: 'Write a prompt for a launch email', mode: 'prompt_only',
  } });
  assert.equal(JSON.parse(promptOnlyTemplate.messages[0].content.text).workflow.final_output, 'improved_prompt');

  const resources = await client.listResources();
  assert.equal(resources.resources[0].uri, 'intent-bridge://guide');
  const guide = await client.readResource({ uri: 'intent-bridge://guide' });
  assert.match(guide.contents[0].text, /Never invent/);

  const invalid = await client.callTool({ name: 'refine_prompt', arguments: { request: ' ' } });
  assert.equal(invalid.isError, true);

  // Each request must preserve its own input when calls run concurrently.
  const outputs = await Promise.all(['첫째 요청', '둘째 요청'].map((request) =>
    client.callTool({ name: 'refine_prompt', arguments: { request } })));
  assert.deepEqual(outputs.map((out) => out.structuredContent.source.request), ['첫째 요청', '둘째 요청']);
}

test('actual child process supports stdio MCP initialization, tools, prompts and resources', async (t) => {
  let stderr = '';
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../src/cli.js', import.meta.url))],
    stderr: 'pipe',
  });
  transport.stderr.on('data', (data) => { stderr += data.toString(); });
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(transport);
  await assertMcpFeatures(client);
  assert.equal(stderr, '');
});

async function httpFixture(t, options) {
  const listener = createHttpApp(options).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { listener.once('listening', resolve); listener.once('error', reject); });
  t.after(() => new Promise((resolve) => { listener.close(resolve); listener.closeAllConnections(); }));
  return new URL(`http://127.0.0.1:${listener.address().port}/mcp`);
}

test('stateless Streamable HTTP supports real MCP clients', async (t) => {
  const url = await httpFixture(t);
  const client = new Client({ name: 'http-integration-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(url));
  await assertMcpFeatures(client);
});

test('HTTP token authentication rejects missing tokens and accepts the configured token', async (t) => {
  const url = await httpFixture(t, { token: 'test-only-token' });
  assert.equal((await fetch(url, { method: 'POST' })).status, 401);
  assert.equal((await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer wrong' } })).status, 401);
  const client = new Client({ name: 'authorized-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: 'Bearer test-only-token' } } }));
  assert.equal((await client.listTools()).tools[0].name, 'refine_prompt');
});

test('HTTP rejects untrusted hosts, origins, malformed JSON and oversized bodies', async (t) => {
  const url = await httpFixture(t);
  // Node fetch may normalize Host; use an actual HTTP request for rebinding checks.
  const untrustedHostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: 'POST', headers: { Host: 'attacker.example' } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(untrustedHostStatus, 403);
  assert.equal((await fetch(url, { method: 'POST', headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', headers: { Origin: 'null' } })).status, 403);
  const invalid = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{private-invalid' });
  assert.equal(invalid.status, 400);
  assert.ok(!(await invalid.text()).includes('private-invalid'));
  const oversized = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: 'x'.repeat(140000) }) });
  assert.equal(oversized.status, 413);
  assert.equal((await fetch(url, { method: 'DELETE' })).status, 405);
  const health = await fetch(new URL('/health', url));
  assert.equal((await health.json()).status, 'ok');
});

test('HTTP rejects invalid configuration and supports a hosting-provided hostname', () => {
  assert.equal(readHttpConfig({}).host, '127.0.0.1');
  assert.equal(readHttpConfig({ PORT: '8080' }).port, 8080);
  assert.ok(readHttpConfig({ RENDER_EXTERNAL_HOSTNAME: 'intent.example.com' }).allowedHosts.includes('intent.example.com'));
  for (const env of [
    { PORT: '0' }, { PORT: '65536' }, { PORT: 'oops' },
    { MCP_ALLOWED_HOSTS: '*' }, { MCP_ALLOWED_HOSTS: 'https://example.com' },
    { MCP_AUTH_TOKEN: '' },
  ]) assert.throws(() => readHttpConfig(env));
});
