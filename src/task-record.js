import { z } from 'zod';
import { intentSchema, coverageSchema } from './intent.js';

export const text = (max) => z.string().trim().min(1).max(max);
export const promptId = z.string().regex(/^prompt_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

// Accept a complete returned brief, but retain only this bounded snapshot.
// This is conversation-supplied evidence, not authenticated server history.
export const taskRecordSchema = z.object({
  prompt_record: z.object({
    id: promptId,
    revision: z.number().int().min(1).max(10000),
    state: z.enum(['ready', 'needs_clarification', 'revision_required']),
    text: z.string().min(1).max(24000),
  }),
  intent_record: intentSchema,
  coverage_record: coverageSchema,
  inherited_sources: z.array(text(16000)).max(18).default([]),
  source: z.object({
    request: text(12000),
    context: text(16000).optional(),
    constraints: z.array(text(2000)).max(20).default([]),
    mode: z.enum(['execute', 'prompt_only']).default('execute'),
  }),
});

export function recordInput(record) {
  return { ...record.source, inherited_sources: record.inherited_sources, intent: record.intent_record, coverage: record.coverage_record, execution_prompt: record.prompt_record.text };
}
