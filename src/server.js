import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { REFINE_TOOL } from './tool-definition.js';
import { buildBrief, buildPromptRequest, refineShape, HOST_INSTRUCTIONS, REWRITE_GUIDANCE } from './prompt.js';

export function createServer() {
  const server = new McpServer(
    { name: 'intent-bridge', version: '0.7.0' },
    { instructions: HOST_INSTRUCTIONS },
  );

  server.registerTool('refine_prompt', { ...REFINE_TOOL, inputSchema: refineShape }, async (input) => {
    const brief = buildBrief(input);
    return {
      content: [{ type: 'text', text: JSON.stringify(brief, null, 2) }],
      structuredContent: brief,
    };
  });

  server.registerPrompt('refine', {
    title: '의도 파악 → 내부 프롬프트 작성 → 작업 수행',
    description: 'Understand a rough request, formulate an internal prompt, and complete the task. Use prompt_only only when the user wants just a prompt.',
    argsSchema: {
      request: z.string().trim().min(1).max(12000).describe('대충 적은 원래 요청'),
      context: z.string().trim().min(1).max(16000).optional().describe('이미 알고 있는 배경 (선택)'),
      language: z.string().trim().min(1).max(80).optional().describe('출력 언어 (기본: 요청 언어)'),
      mode: z.enum(['execute', 'prompt_only']).optional().describe('기본 execute: 의도를 구체화해 작업 수행. prompt_only: 프롬프트만 작성.'),
    },
  }, (input) => ({
    description: input.mode === 'prompt_only' ? 'Write an intent-preserving prompt without performing its task.' : 'Understand intent, prepare an internal prompt, and carry out the original request.',
    messages: [{ role: 'user', content: { type: 'text', text: JSON.stringify(buildPromptRequest(input), null, 2) } }],
  }));

  server.registerResource('prompt-editing-guide', 'intent-bridge://guide', {
    title: 'Intent Bridge 편집 원칙',
    description: 'How to preserve intent, handle unknowns, and improve prompts without extra API calls.',
    mimeType: 'text/plain',
  }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/plain', text: REWRITE_GUIDANCE }] }));

  return server;
}
