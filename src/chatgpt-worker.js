import { z } from 'zod';
import { buildBrief, refineSchema, HOST_INSTRUCTIONS } from './prompt.js';
import { REFINE_TOOL } from './tool-definition.js';

// Sites enforces sign-in and Site access before forwarding /mcp requests.
// No conversations, identities, credentials, or request bodies are stored here.
const MAX_BODY_BYTES = 128 * 1024;
const VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26'];
const SERVER = { name: 'intent-bridge', version: '0.7.0' };
const TOOL = {
  name: 'refine_prompt',
  ...REFINE_TOOL,
  inputSchema: z.toJSONSchema(refineSchema, { target: 'draft-7', io: 'input' }),
  _meta: { 'openai/toolInvocation/invoking': '실행 프롬프트 기록 중', 'openai/toolInvocation/invoked': '실행 프롬프트 기록 완료' },
};

function json(value, status = 200, headers = {}) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

function error(id, code, message, status = 200) {
  return json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, status);
}

async function readBody(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return body + decoder.decode();
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); return null; }
      body += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
}

export async function handleMcp(request) {
  if (request.method !== 'POST') return error(null, -32000, 'Use POST for this stateless MCP endpoint.', 405);
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return error(null, -32000, 'Content-Type must be application/json.', 415);
  }
  const body = await readBody(request);
  if (body === null) return error(null, -32000, 'Request body is too large.', 413);
  let message;
  try { message = JSON.parse(body); }
  catch { return error(null, -32700, 'Invalid JSON.', 400); }
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' ||
    ('id' in message && typeof message.id !== 'string' && !(typeof message.id === 'number' && Number.isFinite(message.id)))) {
    return error(null, -32600, 'Invalid JSON-RPC request.', 400);
  }
  // Notifications have no JSON-RPC response. No session state is required.
  if (!('id' in message)) return new Response(null, { status: 202 });
  const { id, method } = message;
  const params = message.params ?? {};
  if (!params || typeof params !== 'object' || Array.isArray(params)) return error(id, -32602, 'Invalid params.');
  const result = (value) => json({ jsonrpc: '2.0', id, result: value });
  switch (method) {
    case 'server/discover':
      return result({ supportedVersions: VERSIONS, serverInfo: SERVER, capabilities: { tools: {} }, instructions: HOST_INSTRUCTIONS });
    case 'initialize':
      return result({ protocolVersion: VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : '2025-11-25', serverInfo: SERVER, capabilities: { tools: {} }, instructions: HOST_INSTRUCTIONS });
    case 'ping': return result({});
    case 'tools/list': return result({ tools: [TOOL] });
    case 'tools/call': {
      if (params.name !== 'refine_prompt') return error(id, -32602, 'Unknown tool.');
      const parsed = refineSchema.safeParse(params.arguments);
      if (!parsed.success) return result({ isError: true, content: [{ type: 'text', text: 'Invalid tool arguments. Provide request, a nonempty execution_prompt, and intent with goal, deliverable and success_criteria. needs_clarification requires questions; revisions require previous_prompt_id.' }] });
      const brief = buildBrief(parsed.data);
      return result({ content: [{ type: 'text', text: JSON.stringify(brief, null, 2) }], structuredContent: brief });
    }
    default: return error(id, -32601, 'Method not found.');
  }
}

const CONNECT_PAGE = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Automatic AI Prompt · ChatGPT</title><style>body{font:17px/1.8 system-ui;max-width:740px;margin:8vh auto;padding:24px;color:#182c28;background:#f5f8f6}h1{line-height:1.3}code{background:#e3ebe7;padding:3px 7px;border-radius:5px}a{color:#176451}hr{border:0;border-top:1px solid #d6e1da;margin:36px 0}</style><h1>Automatic AI Prompt</h1><p>짧게 부탁하면 AI가 의도를 정리하고 작업까지 이어갑니다.</p><ol><li>ChatGPT의 <strong>Plugins → Personal → Created by you</strong>에서 Automatic AI Prompt를 찾아 Install / Connect를 완료하세요.</li><li>새 채팅에서 플러그인을 선택하고 평소처럼 일을 맡기세요.</li><li>실행 기록의 <code>refine_prompt</code> 호출을 확인하세요.</li></ol><p>단순 지식 질문과 인사는 제외합니다. 자동 사용은 현재 채팅의 도구 제공과 AI 지침 적용에 따라 달라집니다. Codex 로컬 설치와 이 플러그인 연결은 별개입니다.</p><p>목적·결과물·완료 기준과 전달된 조건을 검사합니다. 누락은 AI가 먼저 보완하고 중요한 미확인 사항만 질문하도록 안내합니다. 이 검사는 인용 구절과 항목의 일치에 한정되며 의미나 실제 수행의 증명은 아닙니다. 실제 작성한 실행 프롬프트는 도구 호출 결과에 원문과 개정 번호로 남습니다. 나중에 “처음 사용한 프롬프트 보여줘”라고 요청하면 해당 기록을 인용하도록 안내합니다. 현재 대화에 기록이 없으면 원문을 조회할 수 없습니다.</p><p>별도 모델 API 키가 필요하지 않습니다. 이 서버는 대화 내용을 저장하거나 다른 AI를 호출하지 않습니다. 프롬프트 생성과 실제 작업은 연결한 ChatGPT가 수행합니다.</p><hr><h2 lang="en">Connect to ChatGPT</h2><p lang="en">Install and connect Automatic AI Prompt under Plugins → Personal → Created by you, then select it in a new chat. Check the tool activity for <code>refine_prompt</code>. The actual execution prompt is returned verbatim in the tool result with its revision. Ask to see the first or updated prompt; the AI must quote the available record rather than reconstruct an original. No additional model API key is needed. This server does not store conversations or call another AI. Tool availability and automatic selection depend on ChatGPT.</p><p><a href="https://github.com/dalgonamoo1/automatic-ai-prompt">GitHub · 설치 및 상세 안내 / Installation and guide</a></p></html>`;

export default {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === '/mcp') return await handleMcp(request);
      if (pathname === '/health' && request.method === 'GET') return json({ status: 'ok', ...SERVER });
      if (pathname === '/' && request.method === 'GET') return new Response(CONNECT_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" } });
      return json({ error: 'Not found.' }, 404);
    } catch { return error(null, -32603, 'MCP request failed.', 500); }
  },
};
