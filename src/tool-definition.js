export const REFINE_TOOL = {
    title: '요청 의도 정리 후 작업 수행',
    description: 'Use automatically before each new user task to create, edit, analyze, summarize, plan, code, or produce a deliverable, including detailed requests and small edits; the user need not mention this tool. Question-shaped requests to do work count as tasks. Skip greetings, casual conversation, and simple informational questions, and respect an explicit request to skip the tool. Default execute: use the returned brief to formulate a short internal prompt, ask essential questions if needed, then perform the original task and return its actual result. Call once per new task; after clarification answers, continue without another call or execute request. Set prompt_only if the user explicitly wants only a rewritten prompt. The host AI does the work; this read-only tool itself performs no external actions or LLM calls. Do not echo the generic draft or recursively refine it.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  };
