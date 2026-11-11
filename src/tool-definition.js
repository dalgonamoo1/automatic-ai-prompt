import { PROMPT_VIEW_GUIDANCE } from './prompt-view.js';
import { FOLLOW_UP_GUIDANCE } from './follow-up.js';

export const REFINE_TOOL = {
  title: '실행 프롬프트 원문 기록 후 작업 수행',
  description: PROMPT_VIEW_GUIDANCE + '\n\n' + FOLLOW_UP_GUIDANCE + '\n\nBefore a task, author intent and execution_prompt and record them here. Include all declared conditions or exact coverage quotes for paraphrases. Repair prompt_revision_required before work. Ask only blocking unknowns on clarification_required. Execute a passed ready record, then use check_result with actual evidence before returning the result. prompt_only returns the recorded prompt without embedded execution. Apply to writing, edits, analysis, plans and coding; skip simple informational questions and greetings. Respect explicit tool opt-out and host permissions. No model API, persistent history or semantic/execution guarantee.',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
};
