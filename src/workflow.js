import { z } from 'zod';

// The MCP server is deliberately stateless: all planning, research, and tool execution
// belong to the host model. These functions validate and record host-authored work.
const text = (max) => z.string().trim().min(1).max(max);
const stepId = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);
const recordId = z.string().regex(/^plan_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
export const targetModel = z.enum(['auto', 'chatgpt', 'claude', 'gemini', 'codex']).default('auto');

const guidance = Object.freeze({
  auto: 'Follow the currently connected host model and its available tools. Do not assume a different model is running.',
  chatgpt: 'Use the tools actually available in this chat, source-grounded findings, and clear completion checks.',
  claude: 'Express goals and constraints explicitly, keep examples grounded in the user input, and identify unverified assumptions.',
  gemini: 'Specify evidence and source checks, distinguish uncertain claims, and structure long inputs by task.',
  codex: 'Identify repository scope, concrete file changes, runnable tests, and rollback conditions before code execution.',
});
export function getModelGuidance(model = 'auto') {
  return { target: model, note: guidance[model], optimization_is_guidance_only: true };
}

const stepShape = z.object({
  id: stepId.describe('Stable identifier unique within this plan, for example inspect or implement.'),
  objective: text(3000).describe('An actionable objective, written by the host based on the user request.'),
  action_type: z.enum(['analysis', 'research', 'implementation', 'validation', 'external_write']).default('analysis'),
  dependencies: z.array(stepId).max(20).default([]).describe('IDs of earlier steps that must complete first.'),
  completion_checks: z.array(text(1600)).min(1).max(8).describe('Observable acceptance criteria, not guesses about outcomes.'),
  requires_approval: z.boolean().default(false).describe('Must be true for external_write. The host still enforces its actual approval rules.'),
}).strict();

export const planShape = {
  request: text(12000).describe('Original request, without invented requirements.'),
  goal: text(4000).describe('Host-authored task objective.'),
  context: text(16000).optional(),
  constraints: z.array(text(2000)).max(20).default([]),
  target_model: targetModel.describe('Prompt format preference; does not change the model or invoke another one.'),
  steps: z.array(stepShape).min(1).max(25),
  open_questions: z.array(text(1000)).max(3).default([]),
};

export const planSchema = z.object(planShape).strict().superRefine((input, ctx) => {
  const seen = new Set();
  for (const [i, step] of input.steps.entries()) {
    if (seen.has(step.id)) ctx.addIssue({ code: 'custom', path: ['steps', i, 'id'], message: 'Duplicate step ID.' });
    for (const [j, dependency] of step.dependencies.entries()) {
      if (!seen.has(dependency)) ctx.addIssue({ code: 'custom', path: ['steps', i, 'dependencies', j], message: 'Dependencies must point to distinct earlier steps.' });
    }
    if (step.action_type === 'external_write' && !step.requires_approval) {
      ctx.addIssue({ code: 'custom', path: ['steps', i, 'requires_approval'], message: 'External writes require an explicit approval gate.' });
    }
    seen.add(step.id);
  }
});

export function buildPlan(input) {
  const data = planSchema.parse(input);
  return {
    status: data.open_questions.length ? 'plan_needs_clarification' : 'host_plan_recorded',
    source: { request: data.request, context: data.context, constraints: data.constraints },
    plan_record: {
      id: 'plan_' + crypto.randomUUID(),
      goal: data.goal,
      steps: data.steps,
      open_questions: data.open_questions,
      recorded_at: new Date().toISOString(),
      author: 'host_ai',
      storage: 'mcp_call_result_only',
    },
    model_guidance: getModelGuidance(data.target_model),
    execution_contract: {
      executor: 'host_ai',
      tool_use: 'host_capabilities_only',
      external_writes: 'require_host_permission_and_user_approval',
      evidence: 'completion_checks_must_be_evaluated_after_execution',
      autonomous_execution_performed_by_server: false,
    },
    next_step: data.open_questions.length
      ? 'Ask only the recorded essential questions; revise the plan before dependent execution.'
      : 'Execute in dependency order with the host tools actually available. Obtain required approvals and record evidence; do not claim server-side execution.',
  };
}

const checkShape = z.object({
  criterion: text(1600),
  outcome: z.enum(['pass', 'fail', 'unknown']),
  evidence: text(4000).optional().describe('Concrete test output, file reference, source link, or direct observation; never invent evidence.'),
  evidence_type: z.enum(['test_output', 'source', 'artifact', 'observation', 'self_report']).default('self_report'),
}).strict().superRefine((value, ctx) => {
  if (value.outcome === 'pass' && !value.evidence) {
    ctx.addIssue({ code: 'custom', path: ['evidence'], message: 'A passing claim requires an evidence reference.' });
  }
});

export const reviewShape = {
  request: text(12000),
  result_summary: text(8000),
  plan_id: recordId.optional().describe('Optional plan ID from a prior plan_task result; not verified or looked up by this server.'),
  checks: z.array(checkShape).min(1).max(30),
  follow_up: z.array(text(2000)).max(15).default([]),
};

export const reviewSchema = z.object(reviewShape).strict();

export function buildReview(input) {
  const data = reviewSchema.parse(input);
  const counts = {
    pass: data.checks.filter((c) => c.outcome === 'pass').length,
    fail: data.checks.filter((c) => c.outcome === 'fail').length,
    unknown: data.checks.filter((c) => c.outcome === 'unknown').length,
  };
  const status = counts.fail ? 'needs_revision' : counts.unknown ? 'needs_verification' : 'host_reported_pass';
  return {
    status,
    review_record: {
      id: 'review_' + crypto.randomUUID(),
      ...(data.plan_id ? { plan_id: data.plan_id } : {}),
      request: data.request,
      result_summary: data.result_summary,
      checks: data.checks,
      follow_up: data.follow_up,
      recorded_at: new Date().toISOString(),
      author: 'host_ai',
      storage: 'mcp_call_result_only',
    },
    counts,
    verification_limits: {
      independently_verified_by_server: false,
      evidence_authenticity_checked: false,
      historical_plan_id_verified: false,
      rule: 'This tool records host assessments. The host must run actual tests or consult sources before claiming verification.',
    },
    next_step: status === 'host_reported_pass'
      ? 'Report evidence-backed results and explicitly identify any untested behavior.'
      : 'Address failed or unknown checks, gather real evidence, and run review_result again if materially changed.',
  };
}
