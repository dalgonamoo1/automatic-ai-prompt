import { z } from 'zod';
import { normalize } from './intent.js';
import { taskRecordSchema, text } from './task-record.js';

const sections = ['goal', 'deliverable', 'success_criteria', 'constraints', 'known_facts', 'assumptions', 'unknowns'];
export const followUpSchema = z.object({
  previous: taskRecordSchema.describe('Copy the referenced task’s actual prior returned brief. This is a supplied snapshot, not a server history lookup.'),
  changes: z.array(z.object({
    section: z.enum(sections),
    index: z.number().int().min(0).max(19),
    action: z.enum(['replace', 'remove']),
    source_quote: text(2000).describe('Exact quote from the NEW request/context authorizing this change. Do not cite the old record or invent permission.'),
    current_index: z.number().int().min(0).max(19).optional().describe('Required for replace: index of the replacement in the current section. Use 0 for goal/deliverable.'),
  }).strict()).max(50).default([]),
}).strict();

const includes = (whole, part) => normalize(whole).includes(normalize(part));
export function conditionItems(input) {
  return sections.flatMap((section) => {
    const items = section === 'goal' || section === 'deliverable' ? [input.intent[section]]
      : section === 'constraints' ? input.constraints ?? [] : input.intent[section];
    return items.flatMap((item, index) => {
      if (section === 'unknowns' && !item.answer_quote) return [];
      return [{ section, index, text: section === 'known_facts' ? item.fact : section === 'unknowns' ? item.answer_quote : item }];
    });
  });
}

export function reuseAnswers(input) {
  const previous = input.follow_up?.previous;
  if (!previous) return;
  for (const unknown of input.intent.unknowns) {
    if (unknown.answer_quote) continue;
    const prior = previous.intent_record.unknowns.find(item => normalize(item.question) === normalize(unknown.question) && item.answer_quote);
    // An explicit replacement/removal must not resurrect the old answer.
    const index = previous.intent_record.unknowns.indexOf(prior);
    if (prior && !input.follow_up.changes.some(change => change.section === 'unknowns' && change.index === index)) unknown.answer_quote = prior.answer_quote;
  }
}

export function assessFollowUp(input) {
  if (!input.follow_up) return { status: 'new_or_legacy_revision', retained: [], changed: [], removed: [], issues: [] };
  const { previous, changes } = input.follow_up;
  const old = conditionItems({ intent: previous.intent_record, constraints: previous.source.constraints });
  const current = conditionItems(input);
  const issues = [], retained = [], changed = [], removed = [];
  if (input.previous_prompt_id !== previous.prompt_record.id || input.revision !== previous.prompt_record.revision + 1) issues.push({ code: 'follow_up_revision_mismatch' });
  const seen = new Set();
  for (const change of changes) {
    const key = `${change.section}:${change.index}`;
    if (seen.has(key)) issues.push({ code: 'duplicate_change', section: change.section, index: change.index });
    seen.add(key);
    if (!old.some(item => item.section === change.section && item.index === change.index)) issues.push({ code: 'invalid_change_reference', section: change.section, index: change.index });
    if (![input.request, input.context].filter(Boolean).some(source => includes(source, change.source_quote))) issues.push({ code: 'ungrounded_change_quote', section: change.section, index: change.index });
    if (change.action === 'replace' && !current.some(item => item.section === change.section && item.index === change.current_index)) issues.push({ code: 'missing_replacement', section: change.section, index: change.index });
    if (change.action === 'remove' && change.current_index !== undefined) issues.push({ code: 'unexpected_replacement', section: change.section, index: change.index });
  }
  for (const item of old) {
    const change = changes.find(entry => entry.section === item.section && entry.index === item.index);
    if (change) (change.action === 'remove' ? removed : changed).push({ ...item, ...change });
    else if (current.some(entry => entry.section === item.section && normalize(entry.text) === normalize(item.text)) ||
      (item.section === 'unknowns' && includes(input.execution_prompt, item.text))) retained.push(item);
    else issues.push({ code: 'dropped_previous_condition', ...item });
  }
  return { status: issues.length ? 'needs_revision' : 'passed', previous_prompt_id: previous.prompt_record.id, retained, changed, removed, issues,
    limits: 'Snapshot identity, change authorization and paraphrase meaning are host-supplied, not authenticated or semantically verified.' };
}

export const FOLLOW_UP_GUIDANCE = `For a follow-up such as “shorter”, “keep the earlier conditions” or “also support mobile”, find the referenced task, copy its actual previous brief into follow_up.previous, increment revision, and set previous_prompt_id. Carry forward all unchanged goals, deliverables, criteria, constraints, facts, assumptions and answered unknowns. List only replacements/removals in follow_up.changes with a quote from the new request/context and replacement index. Do not erase requirements just to shorten wording. A paraphrased condition can keep its original intent wording and use coverage for its new prompt wording. Record the revised prompt before dependent work. If the previous record is unavailable, disclose that and ask for essential missing conditions rather than inventing history. For an unrelated task start a new record. For ambiguity about which task is being changed, ask first.

Before asking questions, inspect the current conversation and previous answers. Supply answer_quote when already answered. Matching answered unknowns in the supplied previous snapshot are reused unless explicitly changed. Only genuinely blocking unknowns become questions, at most three in one round; combine related concerns into a concise question, avoid multi-part questionnaires, and use explicit reversible defaults for minor preferences. Do independent useful work while waiting only when it does not depend on the missing answer. Prompt bookkeeping errors are yours to repair, not questions for the user.`;
