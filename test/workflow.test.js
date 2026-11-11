import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, buildReview, planSchema, reviewSchema, getModelGuidance } from '../src/workflow.js';
import { buildBrief } from '../src/prompt.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import worker from '../src/chatgpt-worker.js';

const valid = {
  request: '프로젝트 기능 개선',
  goal: '기존 동작을 보존하면서 개선한다',
  target_model: 'codex',
  steps: [
    { id: 'inspect', objective: '기존 코드 분석', completion_checks: ['관련 파일 확인'] },
    { id: 'change', objective: '변경 수행', action_type: 'implementation', dependencies: ['inspect'], completion_checks: ['코드 변경 완료'] },
    { id: 'check', objective: '테스트 실행', action_type: 'validation', dependencies: ['change'], completion_checks: ['테스트 결과 기록'] },
  ],
};

test('plan is host-authored, dependency-ordered, and never claims execution', () => {
  const value = buildPlan(valid);
  assert.equal(value.status, 'host_plan_recorded');
  assert.equal(value.plan_record.steps.length, 3);
  assert.equal(value.plan_record.steps[2].dependencies[0], 'change');
  assert.equal(value.model_guidance.target, 'codex');
  assert.equal(value.execution_contract.autonomous_execution_performed_by_server, false);
  assert.equal(value.plan_record.storage, 'mcp_call_result_only');
  assert.match(value.plan_record.id, /^plan_/);
  assert.equal(buildPlan({ ...valid, open_questions: ['어떤 브랜치인가요?'] }).status, 'plan_needs_clarification');
  assert.equal(getModelGuidance('chatgpt').optimization_is_guidance_only, true);
});

test('plan rejects cycles, duplicate ids, future dependencies, and unapproved external writes', () => {
  for (const steps of [
    [{ id: 'a', objective: '일', completion_checks: ['완료'] }, { id: 'a', objective: '일', completion_checks: ['완료'] }],
    [{ id: 'a', objective: '일', dependencies: ['b'], completion_checks: ['완료'] }, { id: 'b', objective: '일', completion_checks: ['완료'] }],
    [{ id: 'a', objective: '일', dependencies: ['a'], completion_checks: ['완료'] }],
    [{ id: 'a', objective: '일', action_type: 'external_write', requires_approval: false, completion_checks: ['완료'] }],
  ]) {
    assert.equal(planSchema.safeParse({ ...valid, steps }).success, false);
  }
  assert.equal(planSchema.safeParse({ ...valid, steps: [{ id: 'push', objective: 'PR 생성', action_type: 'external_write', requires_approval: true, completion_checks: ['PR 번호 확인'] }] }).success, true);
});

test('review requires evidence on pass, preserves unknowns, and does not claim independent verification', () => {
  const result = buildReview({ request: '수정 검토', result_summary: '검토됨', checks: [
    { criterion: '테스트 실행', outcome: 'pass', evidence: 'node --test: 5 passed', evidence_type: 'test_output' },
    { criterion: '배포 확인', outcome: 'unknown' },
  ] });
  assert.equal(result.status, 'needs_verification');
  assert.deepEqual(result.counts, { pass: 1, fail: 0, unknown: 1 });
  assert.equal(result.verification_limits.independently_verified_by_server, false);
  assert.equal(buildReview({ request: '검토', result_summary: '실패', checks: [{ criterion: '테스트', outcome: 'fail' }] }).status, 'needs_revision');
  assert.equal(reviewSchema.safeParse({ request: '검토', result_summary: '결과', checks: [{ criterion: '테스트', outcome: 'pass' }] }).success, false);
  assert.equal(buildReview({ request: '검토', result_summary: '확인', checks: [{ criterion: '테스트', outcome: 'pass', evidence: '로그 파일' }] }).status, 'host_reported_pass');
});

test('refine prompt remains backward compatible and adds optional target-specific guidance', () => {
  const old = buildBrief({ request: '고쳐줘', execution_prompt: '주어진 문장을 수정한다.' });
  assert.equal(old.source.request, '고쳐줘');
  assert.equal(old.model_guidance.target, 'auto');
  assert.equal(buildBrief({ request: '고쳐줘', execution_prompt: '주어진 문장을 수정한다.', target_model: 'claude' }).model_guidance.target, 'claude');
});

test('MCP worker exposes plan_task and review_result with validated inputs', async (t) => {
  const client = new Client({ name: 'workflow-test', version: '1.0.0' });
  t.after(() => client.close());
  const url = new URL('https://test.local/mcp');
  await client.connect(new StreamableHTTPClientTransport(url, { fetch: (input, init) => worker.fetch(new Request(input, init)) }));
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map((tool) => tool.name), ['refine_prompt', 'plan_task', 'review_result']);
  const plan = await client.callTool({ name: 'plan_task', arguments: valid });
  assert.equal(plan.structuredContent.status, 'host_plan_recorded');
  const review = await client.callTool({ name: 'review_result', arguments: {
    request: valid.request, result_summary: '아직 모름',
    plan_id: plan.structuredContent.plan_record.id,
    checks: [{ criterion: '테스트', outcome: 'unknown' }],
  } });
  assert.equal(review.structuredContent.status, 'needs_verification');
  const invalid = await client.callTool({ name: 'review_result', arguments: {
    request: '비밀', result_summary: '비밀', checks: [{ criterion: 'test', outcome: 'pass' }],
  } });
  assert.equal(invalid.isError, true);
});
