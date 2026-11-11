import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import { buildBrief, refineSchema } from '../src/prompt.js';
import worker from '../src/chatgpt-worker.js';

const valid = {
  request: '영어 공부 계획 짜줘. 하루 30분씩 일주일이고 여행 회화가 목적이야.',
  execution_prompt: '여행 회화 실력을 위한 영어 공부 계획을 작성한다. 하루 30분씩 일주일 동안 듣기와 말하기를 연습하고 각 날짜의 완료 기준을 제시한다.',
  constraints: ['하루 30분', '일주일'],
  intent: { goal: '여행 회화 실력을 위한', deliverable: '영어 공부 계획', success_criteria: ['각 날짜의 완료 기준을 제시한다.'], known_facts: [{ fact: '여행 회화', source_quote: '여행 회화가 목적' }] },
};
const rpc = async (method, params) => (await (await worker.fetch(new Request('https://intent.example/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }))).json());

test('a concrete prompt preserves declared intent, facts and conditions in one call', () => {
  const out = buildBrief(valid);
  assert.equal(out.quality_gate.status, 'passed');
  assert.equal(out.quality_gate.required_count, out.quality_gate.covered_count);
  assert.equal(out.workflow.ready_for_host_execution, true);
  assert.equal(out.prompt_record.text, valid.execution_prompt);
  assert.deepEqual(out.intent_record.known_facts, valid.intent.known_facts);
  assert.deepEqual(out.questions, []);
});

test('generic or condition-dropping prompts require host revision instead of execution or user questions', () => {
  const out = buildBrief({ ...valid, execution_prompt: '사용자의 요청을 잘 이해하고 작업한다.' });
  assert.equal(out.status, 'prompt_revision_required');
  assert.equal(out.prompt_record.state, 'revision_required');
  assert.equal(out.prompt_record.requested_state, 'ready');
  assert.equal(out.workflow.ready_for_host_execution, false);
  assert.ok(out.quality_gate.issues.some(issue => issue.section === 'goal'));
  assert.ok(out.quality_gate.issues.some(issue => issue.section === 'constraints'));
  assert.deepEqual(out.questions, []);
});

test('one omitted constraint blocks a ready record and can be repaired in a linked revision', () => {
  const first = buildBrief({ ...valid, constraints: [...valid.constraints, '추가 유료 교재 구매 없음'] });
  assert.equal(first.status, 'prompt_revision_required');
  assert.deepEqual(first.quality_gate.issues.map(issue => [issue.code, issue.section, issue.index]), [['missing_prompt_condition', 'constraints', 2]]);
  const second = buildBrief({ ...valid, constraints: [...valid.constraints, '추가 유료 교재 구매 없음'], execution_prompt: valid.execution_prompt + ' 추가 유료 교재 구매 없음.', revision: 2, previous_prompt_id: first.prompt_record.id });
  assert.equal(second.quality_gate.status, 'passed');
  assert.equal(second.prompt_record.previous_prompt_id, first.prompt_record.id);
  assert.equal(first.prompt_record.text, valid.execution_prompt);
});

test('actual paraphrase evidence avoids literal-only false rejection without claiming semantic verification', () => {
  const out = buildBrief({ ...valid, constraints: ['매일 반 시간', '일주일'], coverage: [{ section: 'constraints', index: 0, prompt_quote: '하루 30분' }] });
  assert.equal(out.quality_gate.status, 'passed');
  assert.equal(out.quality_gate.limits.semantic_equivalence_verified, false);
  assert.equal(buildBrief({ ...valid, coverage: [{ section: 'goal', prompt_quote: '없는 구절' }] }).status, 'prompt_revision_required');
  assert.equal(buildBrief({ ...valid, coverage: [{ section: 'constraints', index: 19, prompt_quote: '하루 30분' }] }).status, 'prompt_revision_required');
});

test('claimed facts need a source quote and source fields cannot be joined into fictional evidence', () => {
  const invented = buildBrief({ ...valid, execution_prompt: valid.execution_prompt + ' 예산은 100만원이다.', intent: { ...valid.intent, known_facts: [{ fact: '예산은 100만원이다.', source_quote: '예산은 100만원이다.' }] } });
  assert.ok(invented.quality_gate.issues.some(issue => issue.code === 'ungrounded_fact_quote'));
  const crossSource = buildBrief({ ...valid, request: 'A', context: 'B', intent: { ...valid.intent, known_facts: [{ fact: '여행 회화', source_quote: 'A B' }] } });
  assert.ok(crossSource.quality_gate.issues.some(issue => issue.code === 'ungrounded_fact_quote'));
});

test('blocking ambiguity wins over a caller request to execute immediately', () => {
  const question = '여행 회화와 시험 준비 중 어느 쪽이 목적인가요?';
  const out = buildBrief({ request: '영어 공부 계획 짜줘. 하루 30분씩 일주일이야.', execution_prompt: '영어 공부 계획을 작성한다. 학습 목적을 확인한 뒤 날짜별 완료 기준을 제시한다. 하루 30분씩 일주일로 작성한다.', constraints: ['하루 30분', '일주일'], prompt_state: 'ready', intent: { goal: '영어 공부', deliverable: '계획', success_criteria: ['날짜별 완료 기준을 제시한다.'], unknowns: [{ question, why_it_matters: '학습 내용과 평가 기준이 달라진다.', blocking: true }] } });
  assert.equal(out.status, 'clarification_required');
  assert.equal(out.prompt_record.state, 'needs_clarification');
  assert.deepEqual(out.questions, [question]);
  assert.equal(out.workflow.ready_for_host_execution, false);
});

test('a routine placeholder assumption avoids an unnecessary clarification round', () => {
  const assumption = '수신자 이름은 [이름]으로 표시한다.';
  const out = buildBrief({ request: '일정이 하루 늦는다고 메일 써줘.', execution_prompt: '일정 지연을 알리는 메일 제목과 본문을 작성한다. 하루 늦는다는 사실을 포함한다. ' + assumption, intent: { goal: '일정 지연을 알리는', deliverable: '메일 제목과 본문', success_criteria: ['하루 늦는다는 사실을 포함한다.'], assumptions: [assumption], unknowns: [{ question: '수신자 이름은 무엇인가요?', why_it_matters: '자리표시자로 작성할 수 있다.', blocking: false }] } });
  assert.equal(out.quality_gate.status, 'passed');
  assert.deepEqual(out.questions, []);
  assert.equal(out.workflow.ready_for_host_execution, true);
});

test('unjustified or repeated clarification is rejected, and prompt-only still never executes', () => {
  assert.equal(refineSchema.safeParse({ ...valid, prompt_state: 'needs_clarification', questions: ['무슨 색을 선호하나요?'] }).success, false);
  const item = { question: '목적은 무엇인가요?', why_it_matters: '범위가 달라진다.', blocking: true };
  assert.equal(refineSchema.safeParse({ ...valid, intent: { ...valid.intent, unknowns: [item, item] } }).success, false);
  const out = buildBrief({ ...valid, mode: 'prompt_only' });
  assert.equal(out.status, 'prompt_ready');
  assert.equal(out.workflow.ready_for_host_execution, false);
});

test('Worker publishes an input schema with required intent but optional defaults', async () => {
  const tools = (await rpc('tools/list', {})).result.tools;
  assert.deepEqual(tools.map(tool => tool.name), ['refine_prompt']);
  assert.deepEqual(tools[0].inputSchema.required, ['request', 'intent', 'execution_prompt']);
  const check = new Ajv({ strict: false }).compile(tools[0].inputSchema);
  assert.equal(check(valid), true);
  assert.equal(check({ request: valid.request, execution_prompt: valid.execution_prompt }), false);
  const blocked = (await rpc('tools/call', { name: 'refine_prompt', arguments: { ...valid, constraints: ['조건 누락'] } })).result;
  assert.equal(blocked.structuredContent.status, 'prompt_revision_required');
  assert.equal(blocked.structuredContent.workflow.ready_for_host_execution, false);
});


test('an answer already quoted in supplied context resolves the question rather than repeating intake', () => {
  const question = '학습 목적이 무엇인가요?';
  const answered = { question, why_it_matters: '학습 내용을 정한다.', blocking: true, answer_quote: '여행 회화가 목적' };
  const out = buildBrief({ ...valid, prompt_state: 'needs_clarification', questions: [question], intent: { ...valid.intent, unknowns: [answered] } });
  assert.equal(out.quality_gate.status, 'passed');
  assert.deepEqual(out.questions, []);
  assert.deepEqual(out.quality_gate.resolved_questions, [{ question, answer_quote: answered.answer_quote }]);
  assert.equal(out.workflow.ready_for_host_execution, true);
  const forged = buildBrief({ ...valid, intent: { ...valid.intent, unknowns: [{ ...answered, answer_quote: '존재하지 않는 답변' }] } });
  assert.equal(forged.status, 'prompt_revision_required');
});

test('coding and research fixtures preserve explicit scope and uncertainty without extra model calls', () => {
  const coding = buildBrief({ request: '기존 프로젝트에 회의실 예약 기능 추가해줘. 같은 회의실 중복 예약 금지. 취소는 본인 것만.', context: '현재 로그인 기능이 있다.', constraints: ['같은 회의실 중복 예약 금지', '취소는 본인 것만'], execution_prompt: '회의실 예약 기능을 추가한다. 결과물은 예약 생성·취소 코드와 테스트다. 현재 로그인 기능을 활용한다. 같은 회의실 중복 예약 금지와 취소는 본인 것만 조건을 서버에서도 검증한다. 중복 시간과 취소 권한 테스트를 포함한다.', intent: { goal: '회의실 예약 기능', deliverable: '예약 생성·취소 코드와 테스트', success_criteria: ['서버에서도 검증한다.', '중복 시간과 취소 권한 테스트를 포함한다.'], known_facts: [{ fact: '현재 로그인 기능', source_quote: '현재 로그인 기능이 있다.' }] } });
  assert.equal(coding.quality_gate.status, 'passed');
  const research = buildBrief({ request: '경쟁사 분석해줘. 없는 수치를 만들지 마.', constraints: ['없는 수치를 만들지 마'], execution_prompt: '경쟁사 분석을 수행한다. 비교표와 시사점을 작성한다. 없는 수치를 만들지 마. 확인하지 못한 수치는 미확인으로 표시하고, 실제 확인한 출처만 제시한다.', intent: { goal: '경쟁사 분석', deliverable: '비교표와 시사점', success_criteria: ['실제 확인한 출처만 제시한다.'] } });
  assert.equal(research.quality_gate.status, 'passed');
});
