import { z } from 'zod';
import { assessIntent, normalize } from './intent.js';
import { taskRecordSchema, recordInput, text } from './task-record.js';

export const resultShape = {
  task: taskRecordSchema.describe('Copy the actual ready refine_prompt brief used for this result. Do not invent an earlier record.'),
  result_text: z.string().min(1).max(32000).refine(value => value.trim().length > 0).describe('The exact candidate response or a faithful artifact description with paths. Do not include credentials.'),
  checks: z.array(z.object({
    section: z.enum(['goal', 'deliverable', 'success_criteria', 'constraints']),
    index: z.number().int().min(0).max(19).default(0),
    status: z.enum(['passed', 'failed', 'unverified']),
    result_quote: text(4000).optional().describe('Exact result_text substring relevant to the criterion. Presence is checked; meaning is not.'),
    evidence: z.object({
      kind: z.enum(['inspection', 'test', 'command', 'source']),
      observation: text(4000).describe('Actual inspection, test output or checked source. No fabricated runs or evidence.'),
      outcome: z.enum(['passed', 'failed', 'unverified']),
    }).strict().optional(),
    note: text(2000).optional(),
  }).strict()).max(30).default([]).describe('Assess goal, deliverable, every success criterion and every constraint. Missing or unsupported checks remain unverified.'),
};
export const resultSchema = z.object(resultShape).strict();

export function checkResult(input) {
  const parsed = resultSchema.parse(input);
  const { task, result_text: resultText } = parsed;
  const quality = assessIntent(recordInput(task));
  if (task.prompt_record.state !== 'ready' || task.source.mode !== 'execute' || quality.status !== 'passed') return {
    status: 'invalid_task_record', prompt_id: task.prompt_record.id, ready_to_return: false,
    next_step: 'Use the actual ready execute record. Repair or clarify the prompt before dependent work; do not treat an invalid or prompt-only record as completed.',
  };
  const conditions = [
    { section: 'goal', index: 0, condition: task.intent_record.goal },
    { section: 'deliverable', index: 0, condition: task.intent_record.deliverable },
    ...task.intent_record.success_criteria.map((condition, index) => ({ section: 'success_criteria', index, condition })),
    ...task.source.constraints.map((condition, index) => ({ section: 'constraints', index, condition })),
  ];
  const key = entry => `${entry.section}:${entry.index}`;
  const issues = [];
  const seen = new Set();
  for (const check of parsed.checks) {
    if (!conditions.some(condition => key(condition) === key(check))) issues.push({ code: 'invalid_check_reference', section: check.section, index: check.index });
    if (seen.has(key(check))) issues.push({ code: 'duplicate_check', section: check.section, index: check.index });
    seen.add(key(check));
  }
  const checks = conditions.map(condition => {
    const supplied = parsed.checks.filter(check => key(check) === key(condition));
    if (supplied.length !== 1) return { ...condition, status: 'unverified', reason: supplied.length ? 'duplicate_check' : 'missing_check' };
    const check = supplied[0];
    // A failed observed check cannot be overridden by a caller's passed label.
    const failed = check.status === 'failed' || check.evidence?.outcome === 'failed';
    if (!failed && check.result_quote && !normalize(resultText).includes(normalize(check.result_quote))) return { ...condition, status: 'unverified', reason: 'missing_result_quote' };
    const supported = Boolean(check.result_quote || check.evidence?.outcome === 'passed');
    const status = failed ? 'failed' : check.status === 'passed' && supported && (!check.evidence || check.evidence.outcome === 'passed') ? 'passed' : 'unverified';
    return { ...condition, ...check, status, ...(status === 'unverified' ? { reason: supported ? 'not_confirmed' : 'missing_evidence' } : {}) };
  });
  const failed = checks.filter(check => check.status === 'failed');
  const unverified = checks.filter(check => check.status === 'unverified');
  const status = failed.length ? 'needs_revision' : unverified.length || issues.length ? 'verification_incomplete' : 'host_checks_passed';
  return {
    status, prompt_id: task.prompt_record.id, revision: task.prompt_record.revision,
    ready_to_return: status === 'host_checks_passed', checks, issues,
    summary: { passed: checks.length - failed.length - unverified.length, failed: failed.length, unverified: unverified.length },
    limits: { semantic_correctness_verified: false, evidence_authenticity_verified: false, artifact_execution_verified: false,
      note: 'The host assessed these conditions and supplied evidence. The server checks coverage and quote presence; it does not run tests, fetch sources, judge meaning or prove task success.' },
    next_step: status === 'host_checks_passed'
      ? 'Return the actual task result. Describe checks accurately; this is a host assessment with structural evidence checks, not independently certified success.'
      : status === 'needs_revision'
        ? 'Repair failed task conditions where possible and check the changed result once. Keep the same prompt unless the task itself changed. Do not ask the user to debug your result or loop indefinitely. Disclose any remaining failures.'
        : 'Perform missing practical checks where available. Otherwise return useful work with the material verification limits clearly stated. Do not invent evidence, claim success, or ask unnecessary user questions.',
  };
}

export const RESULT_GUIDANCE = `After performing an execute task, compare the candidate result with the original goal, deliverable, every success criterion and constraint using check_result. Pass the actual ready brief, result_text (or accurate artifact description), and a check per condition with a result quote and/or actual observed evidence. For plans check counts and time totals; for code run relevant available tests; for research inspect actual accessible sources. Do not treat matching words as proof of meaning, fabricate tests, or invent source verification. The server checks bookkeeping and quote presence, while you perform the practical checks. On failure repair the result and recheck once; do not silently weaken the original conditions to pass. On missing tools/evidence, disclose material unverified items and return useful work without an endless loop or unnecessary user questions. Do not run this tool for historical prompt lookups or prompt_only documents. Its status is a host assessment, not independent certification or permission to publish.`;

export const RESULT_TOOL = {
  title: '작업 결과와 원래 조건 대조',
  description: RESULT_GUIDANCE + ' No model API, persistent history, external requests or test execution occurs in this tool. It never grants additional permissions.',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};
