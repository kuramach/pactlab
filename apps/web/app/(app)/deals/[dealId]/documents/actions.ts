'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../../_lib/api';

const uuid = z.uuid();
const MAX_BYTES = 512 * 1024;
const TYPES: Record<string, 'text/plain' | 'text/markdown'> = { txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown' };

function back(dealId: string, outcome: string, documentId?: string): never {
  const query = new URLSearchParams({ outcome, ...(documentId ? { documentId, page: '1' } : {}) });
  redirect(`/deals/${dealId}/documents?${query.toString()}`);
}

/** Upload a text or Markdown document. The API scans, pages and classifies it. */
export async function uploadDocument(dealId: string, formData: FormData): Promise<void> {
  if (!uuid.safeParse(dealId).success) redirect('/deals');
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) back(dealId, 'no-file');
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const contentType = TYPES[extension];
  if (!contentType) back(dealId, 'type');
  if (file.size > MAX_BYTES) back(dealId, 'too-large');
  const dataClass = formData.get('dataClass') === 'FINANCIAL' ? 'FINANCIAL' : 'BUSINESS';
  const result = await apiSend<{ id: string }>('POST', `/v1/deals/${dealId}/documents`, {
    fileName: file.name,
    contentType,
    contentBase64: Buffer.from(await file.arrayBuffer()).toString('base64'),
    dataClass,
    aiExcluded: formData.get('aiExcluded') === 'on',
  });
  if (result.kind === 'ok') back(dealId, 'ok-uploaded', result.data.id);
  back(dealId, result.kind === 'invalid' ? 'rejected' : result.kind);
}

/** Ask the model to draft cited findings from one document. */
export async function extractDocument(dealId: string, documentId: string): Promise<void> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(documentId).success) redirect('/deals');
  const result = await apiSend<{ drafted: number }>('POST', `/v1/deals/${dealId}/documents/${documentId}/extractions`, {});
  if (result.kind === 'ok') back(dealId, `ok-drafted-${result.data.drafted}`, documentId);
  back(dealId, result.kind === 'unavailable' ? 'ai-off' : result.kind === 'invalid' ? 'ai-excluded' : result.kind, documentId);
}

const review = z.strictObject({
  decision: z.enum(['ACCEPT', 'REJECT']),
  rationale: z.string().trim().min(3).max(2000),
  expectedVersion: z.coerce.number().int().min(1),
});

/** Accept or reject an AI draft. Acceptance re-verifies every citation. */
export async function reviewDocumentFinding(dealId: string, findingId: string, documentId: string, formData: FormData): Promise<void> {
  if (![dealId, findingId, documentId].every((id) => uuid.safeParse(id).success)) redirect('/deals');
  const parsed = review.safeParse({
    decision: formData.get('decision'),
    rationale: formData.get('rationale'),
    expectedVersion: formData.get('expectedVersion'),
  });
  if (!parsed.success) back(dealId, 'rationale', documentId);
  const result = await apiSend('POST', `/v1/deals/${dealId}/document-findings/${findingId}/reviews`, parsed.data);
  back(dealId, result.kind === 'ok' ? `ok-${parsed.data.decision.toLowerCase()}` : result.kind, documentId);
}

export type AskState =
  | { kind: 'idle' }
  | { kind: 'error'; message: string }
  | {
      kind: 'answer';
      question: string;
      answer: string | null;
      claims: { statement: string; citations: { documentId: string; pageNumber: number; quote: string; documentName: string | null }[] }[];
      withheld: number;
      model: string;
    };

/** Ask a question across the deal's documents; only cited claims come back. */
export async function askQuestion(dealId: string, _previous: AskState, formData: FormData): Promise<AskState> {
  if (!uuid.safeParse(dealId).success) return { kind: 'error', message: 'Unknown deal.' };
  const question = String(formData.get('question') ?? '').trim();
  if (question.length < 3) return { kind: 'error', message: 'Ask a question of at least a few words.' };
  const result = await apiSend<{
    answer: string | null;
    claims: Extract<AskState, { kind: 'answer' }>['claims'];
    rejectedClaims: unknown[];
    generatedBy: { resolvedModelId: string };
  }>('POST', `/v1/deals/${dealId}/questions`, { question });
  if (result.kind === 'unavailable') return { kind: 'error', message: 'AI is not switched on for this environment yet. Questions will work once the Claude connection is enabled.' };
  if (result.kind === 'invalid') return { kind: 'error', message: 'There are no documents the AI may read in this deal.' };
  if (result.kind !== 'ok') return { kind: 'error', message: 'The question could not be answered. Try again.' };
  return {
    kind: 'answer',
    question,
    answer: result.data.answer,
    claims: result.data.claims,
    withheld: result.data.rejectedClaims.length,
    model: result.data.generatedBy.resolvedModelId,
  };
}
