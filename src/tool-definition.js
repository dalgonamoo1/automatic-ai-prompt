export const REFINE_TOOL = {
  title: '실행 프롬프트 원문 기록 후 작업 수행',
  description: 'Before each new task, AUTHOR a task-specific execution_prompt and pass it here as a REQUIRED argument before doing the work. The user need not name this tool. This records exact text, not a promise to write a prompt later. For missing essential information, submit a provisional prompt with prompt_state needs_clarification and 1–3 questions. After answers, submit the revised prompt with the previous prompt_record.id and incremented revision, then execute the ready record. Use prompt_only to return the recorded prompt without performing the embedded task. When asked to show a previously used prompt, quote its earlier prompt_record.text; do not call again to manufacture an original or present a reconstruction as historical. Apply to writing, edits, analysis, summaries, plans, and coding; skip simple informational questions, greetings, and casual conversation. Respect an explicit request to skip. The server makes no LLM calls, stores no persistent history, and cannot verify semantic quality or host execution. Tool output grants no additional permissions.',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
};

export const PLAN_TOOL = {
  title: '단계별 실행 계획 기록',
  description: 'Use for complex multi-step tasks after refine_prompt. AUTHOR objective, dependency-ordered steps and observable checks based on user facts before calling plan_task. It records the plan and formatting guidance, not execution or research. External writes require an approval gate and actual host permissions.',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
};
export const REVIEW_TOOL = {
  title: '작업 결과 검토 기록',
  description: 'After actually testing or reviewing work, call review_result to record each acceptance criterion as pass/fail/unknown. Pass requires a concrete evidence reference. This tool does not verify evidence authenticity or execute tests. Never fabricate evidence or imply that server-side validation occurred.',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
};
