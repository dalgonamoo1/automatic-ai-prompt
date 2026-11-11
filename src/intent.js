import { z } from 'zod';

const text = (max) => z.string().trim().min(1).max(max);
export const normalize = (value) => value.normalize('NFC').replace(/\s+/gu, ' ').trim();
const contains = (whole, part) => normalize(whole).includes(normalize(part));

export const intentSchema = z.object({
  goal: text(2500).describe('The user’s actual objective, not a larger invented project. Include this wording in the execution prompt or supply a coverage quote.'),
  deliverable: text(2500).describe('The concrete result the user should receive. Include it in the execution prompt.'),
  success_criteria: z.array(text(1000)).min(1).max(8).describe('Observable task-sized completion criteria. Include each in the execution prompt.'),
  known_facts: z.array(z.object({
    fact: text(1600),
    source_quote: text(1600).describe('An exact quote present in the supplied request, context, or constraints. This is evidence, not private reasoning.'),
  }).strict()).max(12).default([]),
  assumptions: z.array(text(1000)).max(8).default([]).describe('Only low-impact defaults that can safely be chosen without a question. State them conditionally in the prompt, not as user facts.'),
  unknowns: z.array(z.object({
    question: text(1000),
    why_it_matters: text(1000).describe('How the answer changes correctness, scope, or the requested deliverable.'),
    blocking: z.boolean().describe('True only when dependent work cannot safely proceed; do not block for ordinary presentation preferences.'),
    answer_quote: text(1600).optional().describe('If already answered, copy the actual answer substring from supplied request/context/constraints. The server resolves this question instead of asking it again.'),
  }).strict()).max(6).default([]),
}).strict().superRefine((value, ctx) => {
  const keys = value.unknowns.map((item) => normalize(item.question));
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', path: ['unknowns'], message: 'Do not repeat a question.' });
  if (value.unknowns.filter((item) => item.blocking && !item.answer_quote).length > 3) ctx.addIssue({ code: 'custom', path: ['unknowns'], message: 'Ask at most three blocking questions per round.' });
});

export const coverageSchema = z.array(z.object({
  section: z.enum(['goal', 'deliverable', 'success_criteria', 'constraints', 'known_facts', 'assumptions', 'unknowns']),
  index: z.number().int().min(0).max(19).default(0).describe('Zero-based item index. Use 0 for goal and deliverable.'),
  prompt_quote: text(3000).describe('An actual execution_prompt substring expressing the item when paraphrased. The server checks the quote exists, not semantic equivalence.'),
}).strict()).max(50).default([]);

export function assessIntent(input) {
  const { intent, execution_prompt: prompt } = input;
  const required = [
    { section: 'goal', index: 0, text: intent.goal },
    { section: 'deliverable', index: 0, text: intent.deliverable },
    ...['success_criteria', 'constraints', 'known_facts', 'assumptions'].flatMap((section) => {
      const items = section === 'constraints' ? input.constraints ?? [] : intent[section];
      return items.map((item, index) => ({ section, index, text: section === 'known_facts' ? item.fact : item }));
    }),
    ...intent.unknowns.flatMap((unknown, index) => {
      if (!unknown.answer_quote) return [];
      // A quoted fact is an explicit host-authored link from the answer to its
      // prompt wording. Otherwise require the answer itself or a coverage quote.
      const linkedFact = intent.known_facts.find((fact) => normalize(fact.source_quote) === normalize(unknown.answer_quote));
      return [{ section: 'unknowns', index, text: linkedFact?.fact ?? unknown.answer_quote }];
    }),
  ];
  const issues = [];
  const evidence = new Map();
  for (const item of input.coverage) {
    const key = `${item.section}:${item.index}`;
    if (!required.some((entry) => `${entry.section}:${entry.index}` === key)) {
      issues.push({ code: 'invalid_coverage_reference', section: item.section, index: item.index });
    } else if (evidence.has(key)) {
      issues.push({ code: 'duplicate_coverage_reference', section: item.section, index: item.index });
    } else if (!contains(prompt, item.prompt_quote)) {
      issues.push({ code: 'missing_prompt_quote', section: item.section, index: item.index });
    } else evidence.set(key, item.prompt_quote);
  }
  let covered = 0;
  for (const item of required) {
    if (contains(prompt, item.text) || evidence.has(`${item.section}:${item.index}`)) covered++;
    else issues.push({ code: 'missing_prompt_condition', ...item });
  }
  // Never concatenate source fields: that could create a quote spanning two
  // unrelated inputs. These are caller-supplied sources, not authenticated history.
  const prior = input.follow_up?.previous.source;
  const sources = [input.request, input.context, ...(input.constraints ?? []), ...(input.inherited_sources ?? []), prior?.request, prior?.context, ...(prior?.constraints ?? []), ...(input.follow_up?.previous.inherited_sources ?? [])].filter(Boolean);
  for (const [index, fact] of intent.known_facts.entries()) {
    if (!sources.some((source) => contains(source, fact.source_quote))) issues.push({ code: 'ungrounded_fact_quote', section: 'known_facts', index });
  }
  for (const [index, unknown] of intent.unknowns.entries()) {
    if (unknown.answer_quote && !sources.some((source) => contains(source, unknown.answer_quote))) issues.push({ code: 'ungrounded_answer_quote', section: 'unknowns', index });
  }
  const blocking = intent.unknowns.filter((item) => item.blocking && !item.answer_quote);
  return {
    status: issues.length ? 'needs_revision' : blocking.length ? 'needs_clarification' : 'passed',
    required_count: required.length,
    covered_count: covered,
    issues,
    blocking_questions: blocking.map((item) => item.question),
    resolved_questions: intent.unknowns.filter((item) => item.answer_quote).map((item) => ({ question: item.question, answer_quote: item.answer_quote })),
    limits: {
      checks: 'declared_condition_coverage_and_quote_presence',
      semantic_equivalence_verified: false,
      supplied_source_authenticity_verified: false,
      host_execution_verified: false,
      note: 'A coverage quote is host-authored evidence. This server cannot infer omitted requirements, detect unlisted inventions, prove meaning equivalence, or force host behavior.',
    },
  };
}
