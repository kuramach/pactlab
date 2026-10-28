'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { AI_UNAVAILABLE, aiOutcome } from './ai-messages';
import { apiSend } from '../../_lib/api';
import { checkFile, UPLOAD_PROBLEMS } from './upload-rules';

const uuid = z.uuid();

function back(dealId: string, outcome: string, documentId?: string): never {
  const query = new URLSearchParams({ outcome, ...(documentId ? { documentId, page: '1' } : {}) });
  redirect(`/deals/${dealId}/documents?${query.toString()}`);
}

export type UploadResult = { kind: 'ok'; id: string; duplicate: boolean } | { kind: 'error'; message: string };

/**
 * Upload one PDF, Word, Excel, CSV, text or Markdown document and say what
 * happened. Returns instead of redirecting, so a multi-file upload keeps
 * every file's outcome on screen. The API scans, pages and classifies it.
 */
export async function uploadOne(dealId: string, formData: FormData): Promise<UploadResult> {
  if (!uuid.safeParse(dealId).success) return { kind: 'error', message: 'Unknown deal.' };
  const file = formData.get('file');
  if (!(file instanceof File)) return { kind: 'error', message: UPLOAD_PROBLEMS['no-file'] };
  const checked = checkFile(file.name, file.size);
  if ('problem' in checked) return { kind: 'error', message: UPLOAD_PROBLEMS[checked.problem] };
  const result = await apiSend<{ id: string; duplicate?: boolean }>('POST', `/v1/deals/${dealId}/documents`, {
    fileName: file.name,
    contentType: checked.contentType,
    contentBase64: Buffer.from(await file.arrayBuffer()).toString('base64'),
    dataClass: formData.get('dataClass') === 'FINANCIAL' ? 'FINANCIAL' : 'BUSINESS',
    aiExcluded: formData.get('aiExcluded') === 'on',
  });
  if (result.kind === 'ok') return { kind: 'ok', id: result.data.id, duplicate: result.data.duplicate === true };
  if (result.kind === 'invalid') return { kind: 'error', message: UPLOAD_PROBLEMS.rejected };
  if (result.kind === 'unavailable') return { kind: 'error', message: UPLOAD_PROBLEMS.unavailable };
  if (result.kind === 'forbidden') return { kind: 'error', message: 'You do not have permission to upload to this deal.' };
  return { kind: 'error', message: UPLOAD_PROBLEMS.failed };
}

export type ExtractResult = { kind: 'ok'; drafted: number } | { kind: 'skipped'; message: string } | { kind: 'error'; message: string };

/** Draft cited findings from one document, returning the outcome (used right after upload). */
export async function extractOne(dealId: string, documentId: string): Promise<ExtractResult> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(documentId).success) return { kind: 'error', message: 'Unknown document.' };
  const result = await apiSend<{ drafted: number }>('POST', `/v1/deals/${dealId}/documents/${documentId}/extractions`, {});
  if (result.kind === 'ok') return { kind: 'ok', drafted: result.data.drafted };
  if (result.kind === 'invalid') return { kind: 'skipped', message: 'Kept away from AI — no drafts for this document.' };
  if (result.kind === 'unavailable') return { kind: 'error', message: AI_UNAVAILABLE[aiOutcome(result.code)] };
  return { kind: 'error', message: 'AI extraction failed. Use “Re-run AI extraction” on the document to try again.' };
}

/** Ask the model to draft cited findings from one document. */
export async function extractDocument(dealId: string, documentId: string): Promise<void> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(documentId).success) redirect('/deals');
  const result = await apiSend<{ drafted: number }>('POST', `/v1/deals/${dealId}/documents/${documentId}/extractions`, {});
  if (result.kind === 'ok') back(dealId, `ok-drafted-${result.data.drafted}`, documentId);
  back(dealId, result.kind === 'unavailable' ? aiOutcome(result.code) : result.kind === 'invalid' ? 'ai-excluded' : result.kind, documentId);
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
  if (result.kind === 'unavailable') return { kind: 'error', message: AI_UNAVAILABLE[aiOutcome(result.code)] };
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
