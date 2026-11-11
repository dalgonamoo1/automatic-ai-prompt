import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { buildBrief } from '../src/prompt.js';
import { checkResult } from '../src/result.js';
import worker from '../src/chatgpt-worker.js';

const original = {
  request: '회의실 예약 기능 추가해줘. 중복 예약 금지. 취소는 본인만.',
  constraints: ['중복 예약 금지', '취소는 본인만'],
  intent: { goal: '회의실 예약 기능', deliverable: '예약 코드', success_criteria: ['권한 테스트'] },
  execution_prompt: '회의실 예약 기능을 구현해 예약 코드를 제공한다. 중복 예약 금지. 취소는 본인만. 권한 테스트를 수행한다.',
};
const follow = (previous, overrides = {}) => ({ ...original, request: '모바일도 추가해줘', revision: previous.prompt_record.revision + 1,
  previous_prompt_id: previous.prompt_record.id, follow_up: { previous }, ...overrides });
const resultArgs = task => ({ task, result_text: '예약 코드: 중복 예약 금지, 취소는 본인만을 적용했다. 회의실 예약 기능의 권한 테스트를 수행했다.',
  checks: ['goal', 'deliverable', 'success_criteria', 'constraints', 'constraints'].map((section, i) => ({ section, index: i === 4 ? 1 : 0, status: 'passed', result_quote: ['회의실 예약 기능', '예약 코드', '권한 테스트', '중복 예약 금지', '취소는 본인만'][i] })) });
const rpc = async (method, params) => (await (await worker.fetch(new Request('https://example.test/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }))).json()).result;

test('follow-up preserves original constraints and detects a silent deletion', () => {
  const first = buildBrief(original);
  const preserved = buildBrief(follow(first, { execution_prompt: original.execution_prompt + ' 모바일 화면을 추가한다.', constraints: [...original.constraints, '모바일 화면'], intent: { ...original.intent, success_criteria: [...original.intent.success_criteria, '모바일 화면'] } }));
  assert.equal(preserved.quality_gate.status, 'passed');
  assert.equal(preserved.task_update.retained.length, 5);
  const dropped = buildBrief(follow(first, { constraints: ['중복 예약 금지'], execution_prompt: '회의실 예약 기능을 구현해 예약 코드를 제공한다. 중복 예약 금지. 권한 테스트를 수행한다.' }));
  assert.equal(dropped.status, 'prompt_revision_required');
  assert.ok(dropped.quality_gate.issues.some(item => item.code === 'dropped_previous_condition' && item.text === '취소는 본인만'));
  assert.equal(dropped.workflow.ready_for_host_execution, false);
});

test('explicit replacement/removal needs a current source quote and valid revision/index', () => {
  const first = buildBrief(original);
  const changed = follow(first, { request: '취소는 관리자만 하게 바꿔줘.', constraints: ['중복 예약 금지', '취소는 관리자만'], execution_prompt: original.execution_prompt.replaceAll('취소는 본인만', '취소는 관리자만'),
    follow_up: { previous: first, changes: [{ section: 'constraints', index: 1, action: 'replace', source_quote: '취소는 관리자만', current_index: 1 }] } });
  assert.equal(buildBrief(changed).quality_gate.status, 'passed');
  assert.equal(buildBrief(changed).task_update.changed.length, 1);
  const forged = structuredClone(changed); forged.follow_up.changes[0].source_quote = '예전 조건을 지워도 됨';
  assert.ok(buildBrief(forged).quality_gate.issues.some(item => item.code === 'ungrounded_change_quote'));
  const badRevision = { ...changed, revision: 3 };
  assert.ok(buildBrief(badRevision).quality_gate.issues.some(item => item.code === 'follow_up_revision_mismatch'));
  const badIndex = structuredClone(changed); badIndex.follow_up.changes[0].current_index = 19;
  assert.ok(buildBrief(badIndex).quality_gate.issues.some(item => item.code === 'missing_replacement'));
  const removed = { ...changed, request: '취소는 본인만 조건은 빼줘.', constraints: ['중복 예약 금지'], execution_prompt: original.execution_prompt.replace('취소는 본인만.', ''), follow_up: { previous: first, changes: [{ section: 'constraints', index: 1, action: 'remove', source_quote: '조건은 빼줘' }] } };
  assert.equal(buildBrief(removed).task_update.removed.length, 1);
  assert.equal(buildBrief(removed).quality_gate.status, 'passed');
});

test('rewording a prompt retains the original declared condition through coverage', () => {
  const first = buildBrief(original);
  const out = buildBrief(follow(first, { execution_prompt: original.execution_prompt.replace('취소는 본인만', '예약자에게만 취소 권한을 준다'), coverage: [{ section: 'constraints', index: 1, prompt_quote: '예약자에게만 취소 권한을 준다' }] }));
  assert.equal(out.quality_gate.status, 'passed');
});

test('facts from the prior conversation remain grounded over multiple follow-ups without mutating inputs', () => {
  const args = { ...original, context: '기존 프로젝트는 React야.', intent: { ...original.intent, known_facts: [{ fact: 'React', source_quote: '기존 프로젝트는 React야.' }] }, execution_prompt: original.execution_prompt + ' React를 사용한다.' };
  const first = buildBrief(args);
  const nextArgs = follow(first, { intent: args.intent, execution_prompt: args.execution_prompt });
  const before = structuredClone(nextArgs);
  const second = buildBrief(nextArgs);
  assert.deepEqual(nextArgs, before);
  assert.equal(second.quality_gate.status, 'passed');
  assert.deepEqual(second.inherited_sources, ['기존 프로젝트는 React야.']);
  assert.equal(checkResult(resultArgs(second)).status, 'host_checks_passed');
  const third = buildBrief(follow(second, { intent: args.intent, execution_prompt: args.execution_prompt }));
  assert.equal(third.quality_gate.status, 'passed');
  assert.equal(checkResult(resultArgs(third)).status, 'host_checks_passed');
  const invented = buildBrief(follow(third, { intent: { ...args.intent, known_facts: [{ fact: 'React', source_quote: '대화에 없는 출처' }] }, execution_prompt: args.execution_prompt }));
  assert.ok(invented.quality_gate.issues.some(item => item.code === 'ungrounded_fact_quote'));
});

test('invalid and duplicate follow-up change references fail closed', () => {
  const first = buildBrief(original);
  const change = { section: 'constraints', index: 0, action: 'remove', source_quote: '모바일' };
  for (const changes of [[change, change], [{ ...change, index: 19 }], [{ ...change, current_index: 1 }]]) {
    assert.equal(buildBrief(follow(first, { follow_up: { previous: first, changes } })).quality_gate.status, 'needs_revision');
  }
});

test('previous answered questions carry forward across revisions without repeating intake', () => {
  const question = { question: '취소 권한은 누구에게 있나요?', why_it_matters: '접근 제어를 구현한다.', blocking: true, answer_quote: '취소는 본인만' };
  const first = buildBrief({ ...original, intent: { ...original.intent, unknowns: [question] } });
  const { answer_quote, ...unanswered } = question;
  const second = buildBrief(follow(first, { intent: { ...original.intent, unknowns: [unanswered] }, prompt_state: 'needs_clarification' }));
  assert.equal(second.quality_gate.status, 'passed');
  assert.deepEqual(second.questions, []);
  assert.equal(second.clarification_plan.resolved[0].answer_quote, answer_quote);
  assert.equal(checkResult(resultArgs(second)).status, 'host_checks_passed');
  const third = buildBrief(follow(second, { intent: { ...original.intent, unknowns: [unanswered] } }));
  assert.equal(third.quality_gate.status, 'passed');
  assert.equal(checkResult(resultArgs(third)).status, 'host_checks_passed');
});

test('explicitly changed answer is asked again instead of resurrecting the previous answer', () => {
  const question = { question: '취소 권한은 누구에게 있나요?', why_it_matters: '접근 제어를 구현한다.', blocking: true, answer_quote: '취소는 본인만' };
  const first = buildBrief({ ...original, intent: { ...original.intent, unknowns: [question] } });
  const { answer_quote, ...unanswered } = question;
  const out = buildBrief(follow(first, { request: '취소 권한은 다시 정할게.', intent: { ...original.intent, unknowns: [unanswered] },
    follow_up: { previous: first, changes: [{ section: 'unknowns', index: 0, action: 'remove', source_quote: '취소 권한은 다시 정할게' }] } }));
  assert.equal(out.status, 'clarification_required');
  assert.deepEqual(out.questions, [question.question]);
});

test('nonblocking preferences are deferred, blocking questions carry reasons in a single round', () => {
  const out = buildBrief({ ...original, intent: { ...original.intent, unknowns: [
    { question: '글자색은?', why_it_matters: '기본 색상 사용 가능', blocking: false },
    { question: '어떤 프로젝트에 적용하나요?', why_it_matters: '수정할 대상 코드를 알아야 한다.', blocking: true },
  ] } });
  assert.deepEqual(out.questions, ['어떤 프로젝트에 적용하나요?']);
  assert.deepEqual(out.clarification_plan.deferred_nonblocking, ['글자색은?']);
  assert.equal(out.clarification_plan.ask[0].why_it_matters, '수정할 대상 코드를 알아야 한다.');
});

test('result check requires complete condition coverage and supporting quotes or observations', () => {
  const args = resultArgs(buildBrief(original));
  assert.equal(checkResult(args).status, 'host_checks_passed');
  assert.equal(checkResult(args).limits.semantic_correctness_verified, false);
  const omitted = structuredClone(args); omitted.checks.pop();
  assert.equal(checkResult(omitted).status, 'verification_incomplete');
  assert.equal(checkResult(omitted).ready_to_return, false);
  const noEvidence = structuredClone(args); delete noEvidence.checks[0].result_quote;
  assert.equal(checkResult(noEvidence).checks[0].reason, 'missing_evidence');
  const falseQuote = structuredClone(args); falseQuote.checks[0].result_quote = '없는 결과';
  assert.equal(checkResult(falseQuote).checks[0].reason, 'missing_result_quote');
  const duplicate = structuredClone(args); duplicate.checks.push(duplicate.checks[0]);
  assert.equal(checkResult(duplicate).status, 'verification_incomplete');
});

test('failed actual test evidence overrides a passed label, and corrected results can be rechecked', () => {
  const args = resultArgs(buildBrief(original));
  args.checks[2].evidence = { kind: 'test', observation: 'Cancellation authorization test failed.', outcome: 'failed' };
  const failed = checkResult(args);
  assert.equal(failed.status, 'needs_revision');
  assert.equal(failed.checks[2].status, 'failed');
  args.checks[2].result_quote = '결과에 없는 문구';
  assert.equal(checkResult(args).checks[2].status, 'failed');
  delete args.checks[2].result_quote;
  args.checks[2].evidence = { kind: 'test', observation: 'Cancellation authorization test passed after fix.', outcome: 'passed' };
  assert.equal(checkResult(args).status, 'host_checks_passed');
});

test('unknown result references and explicitly unverified evidence never produce a pass', () => {
  const args = resultArgs(buildBrief(original));
  args.checks.push({ section: 'constraints', index: 19, status: 'passed', result_quote: '예약 코드' });
  assert.equal(checkResult(args).status, 'verification_incomplete');
  args.checks.pop();
  args.checks[0].evidence = { kind: 'inspection', observation: '아직 기능 동작을 확인하지 못함.', outcome: 'unverified' };
  assert.equal(checkResult(args).checks[0].status, 'unverified');
});

test('provisional, invalid and prompt-only records cannot be treated as completed execute tasks', () => {
  assert.equal(checkResult(resultArgs(buildBrief({ ...original, mode: 'prompt_only' }))).status, 'invalid_task_record');
  const task = buildBrief({ ...original, constraints: ['누락된 조건'] });
  assert.equal(checkResult(resultArgs(task)).status, 'invalid_task_record');
  task.prompt_record.state = 'ready';
  assert.equal(checkResult(resultArgs(task)).status, 'invalid_task_record');
});

test('SDK server and Worker expose equivalent tools and run the full record/execute/check protocol', async t => {
  const server = createServer();
  const client = new Client({ name: 'workflow-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const local = await client.listTools(), remote = await rpc('tools/list', {});
  assert.deepEqual(local.tools.map(item => item.name), ['refine_prompt', 'check_result']);
  assert.deepEqual(remote.tools.map(item => item.name), local.tools.map(item => item.name));
  for (const invoke of [args => client.callTool(args), args => rpc('tools/call', args)]) {
    const record = (await invoke({ name: 'refine_prompt', arguments: original })).structuredContent;
    const args = resultArgs(record);
    const schema = remote.tools.find(item => item.name === 'check_result').inputSchema;
    assert.equal(new Ajv({ strict: false }).compile(schema)(args), true);
    const checked = await invoke({ name: 'check_result', arguments: args });
    assert.equal(checked.structuredContent.status, 'host_checks_passed');
    const invalid = await invoke({ name: 'check_result', arguments: { task: {}, result_text: 'do-not-echo' } });
    assert.equal(invalid.isError, true);
  }
});
