'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { AI_UNAVAILABLE, aiOutcome } from './ai-messages';
import { apiSend } from '../../_lib/api';
import { checkFile, isArchive, UPLOAD_PROBLEMS } from './upload-rules';

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
  if (isArchive(file.name)) return { kind: 'error', message: 'Zip files go through the archive upload.' };
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

export interface ArchiveFile {
  readonly path: string;
  readonly outcome: 'UPLOADED' | 'DUPLICATE' | 'REJECTED' | 'SKIPPED';
  readonly reason: string | null;
  readonly documentId: string | null;
}

export type ArchiveResult = { kind: 'ok'; files: ArchiveFile[] } | { kind: 'error'; message: string };

const ARCHIVE_PROBLEMS: Readonly<Record<string, string>> = {
  ARCHIVE_NOT_A_ZIP: 'This is not a zip file Pactlab can open. Nothing was uploaded.',
  ARCHIVE_EMPTY: 'The zip has no files in it. Nothing was uploaded.',
};

/**
 * Upload a zip of deal files (T-098). The API unpacks it and uploads every
 * file inside on its own; each file's outcome comes back so the screen can
 * list them all — nothing in the archive disappears silently.
 */
export async function uploadArchive(dealId: string, formData: FormData): Promise<ArchiveResult> {
  if (!uuid.safeParse(dealId).success) return { kind: 'error', message: 'Unknown deal.' };
  const file = formData.get('file');
  if (!(file instanceof File) || !isArchive(file.name)) return { kind: 'error', message: UPLOAD_PROBLEMS['no-file'] };
  const checked = checkFile(file.name, file.size);
  if ('problem' in checked) return { kind: 'error', message: UPLOAD_PROBLEMS[checked.problem] };
  const result = await apiSend<{ files: { path: string; outcome: ArchiveFile['outcome']; reason: string | null; document: { id: string } | null }[] }>(
    'POST',
    `/v1/deals/${dealId}/document-archives`,
    {
      fileName: file.name,
      contentBase64: Buffer.from(await file.arrayBuffer()).toString('base64'),
      dataClass: formData.get('dataClass') === 'FINANCIAL' ? 'FINANCIAL' : 'BUSINESS',
      aiExcluded: formData.get('aiExcluded') === 'on',
    },
  );
  if (result.kind === 'ok') {
    return { kind: 'ok', files: result.data.files.map((entry) => ({ path: entry.path, outcome: entry.outcome, reason: entry.reason, documentId: entry.document?.id ?? null })) };
  }
  if (result.kind === 'invalid') return { kind: 'error', message: (result.code && ARCHIVE_PROBLEMS[result.code]) ?? UPLOAD_PROBLEMS.rejected };
  if (result.kind === 'unavailable') return { kind: 'error', message: UPLOAD_PROBLEMS.unavailable };
  if (result.kind === 'forbidden') return { kind: 'error', message: 'You do not have permission to upload to this deal.' };
  return { kind: 'error', message: 'The zip was not accepted. It may be over 10 MB, hold more than 200 files or unpack to more than 100 MB. Nothing was uploaded.' };
}

/** Where a filed document goes next (mirrors the API's route). */
export type IntakeRoute = { kind: 'IMPORT'; target: string } | { kind: 'BALANCE_SHEET' } | { kind: 'EXTRACT' } | { kind: 'FILE' };

export type ClassifyResult =
  | { kind: 'filed'; label: string; route: IntakeRoute; counterpartyName: string | null; byPerson: boolean }
  | { kind: 'needs-you'; question: string }
  | { kind: 'error'; message: string };

type IntakeResponse = { state: string; label: string | null; route: IntakeRoute | null; question: string | null; counterpartyName: string | null; source: 'AI' | 'PERSON' | null };

/** The AI reads one document and files it, or leaves a question for a person (T-098). */
export async function classifyOne(dealId: string, documentId: string): Promise<ClassifyResult> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(documentId).success) return { kind: 'error', message: 'Unknown document.' };
  const result = await apiSend<IntakeResponse>('POST', `/v1/deals/${dealId}/documents/${documentId}/classification`, {});
  if (result.kind === 'ok') {
    const data = result.data;
    if (data.state === 'FILED' && data.route && data.label) {
      return { kind: 'filed', label: data.label, route: data.route, counterpartyName: data.counterpartyName, byPerson: data.source === 'PERSON' };
    }
    return { kind: 'needs-you', question: data.question ?? 'What is this file?' };
  }
  if (result.kind === 'unavailable') return { kind: 'error', message: AI_UNAVAILABLE[aiOutcome(result.code)] };
  return { kind: 'error', message: 'Pactlab could not sort this file. It is listed under “Pactlab needs you” on the next refresh.' };
}

export type CategorizeResult = { kind: 'ok' } | { kind: 'error'; message: string };

/** A person files a document: answers the AI's question or corrects its category. */
export async function categorizeDocument(dealId: string, documentId: string, category: string): Promise<CategorizeResult> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(documentId).success) return { kind: 'error', message: 'Unknown document.' };
  if (!/^[A-Z][A-Z0-9_]{1,59}$/.test(category)) return { kind: 'error', message: 'Choose what this file is.' };
  const result = await apiSend('PUT', `/v1/deals/${dealId}/documents/${documentId}/category`, { category });
  if (result.kind === 'ok') return { kind: 'ok' };
  if (result.kind === 'forbidden') return { kind: 'error', message: 'You do not have permission to file documents in this deal.' };
  if (result.kind === 'invalid') return { kind: 'error', message: 'That category is not offered for this pact.' };
  return { kind: 'error', message: 'The answer was not saved. Try again.' };
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

export type DecideResult = { kind: 'ok' } | { kind: 'error'; message: string };

/**
 * Accept or reject an AI draft in place (T-094 B4): returns the outcome
 * instead of redirecting, so the reviewer keeps their place in the queue.
 * Acceptance re-verifies every citation on the API.
 */
export async function decideDocumentFinding(
  dealId: string,
  findingId: string,
  input: { decision: 'ACCEPT' | 'REJECT'; rationale: string; expectedVersion: number },
): Promise<DecideResult> {
  if (![dealId, findingId].every((id) => uuid.safeParse(id).success)) return { kind: 'error', message: 'Unknown finding.' };
  const parsed = review.safeParse(input);
  if (!parsed.success) return { kind: 'error', message: 'Write a short rationale (a few words) for the decision.' };
  const result = await apiSend('POST', `/v1/deals/${dealId}/document-findings/${findingId}/reviews`, parsed.data);
  if (result.kind === 'ok') return { kind: 'ok' };
  if (result.kind === 'conflict') return { kind: 'error', message: 'Someone else decided this draft first, or it changed. The queue has been refreshed.' };
  if (result.kind === 'invalid') return { kind: 'error', message: 'A citation no longer matches its page, so this draft cannot be accepted. Reject it or ask for support.' };
  if (result.kind === 'forbidden') return { kind: 'error', message: 'You do not have permission to decide findings in this deal.' };
  return { kind: 'error', message: 'The decision was not saved. Try again.' };
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

export interface SourceSyncFile {
  readonly path: string;
  readonly outcome: 'NEW' | 'UPDATED' | 'UNCHANGED' | 'DUPLICATE' | 'REMOVED' | 'SKIPPED' | 'REJECTED';
  readonly reason: string | null;
  readonly documentId: string | null;
}

const SOURCE_PROBLEMS: Readonly<Record<string, string>> = {
  SOURCE_ACCESS: 'Pactlab could not sign in to this source. Check the access token is current and read-only access was granted.',
  SOURCE_NOT_FOUND: 'That folder or room was not found. Check the folder id.',
  SOURCE_NOT_CONFIGURED: 'This kind of data room cannot be read live yet. Export it as a zip and upload that instead.',
  SOURCE_UNAVAILABLE: 'The source did not answer. Try again in a minute.',
  FIXTURES_OFF: 'Synthetic data rooms are only available in local and dev environments.',
};

const sourceProblem = (result: { kind: string; code?: string }) =>
  ('code' in result && result.code && SOURCE_PROBLEMS[result.code]) ||
  (result.kind === 'forbidden' ? 'You do not have permission to manage data rooms in this deal.' : 'The data room could not be read. Try again.');

/** Connect a data room or drive folder (T-098). A live token goes to the secret store and is never shown again. */
export async function connectSource(
  dealId: string,
  input: { provider: 'google-drive' | 'onedrive' | 'vdr'; mode: 'FIXTURE' | 'LIVE'; displayName: string; folder: string; token?: string },
): Promise<{ kind: 'ok'; id: string } | { kind: 'error'; message: string }> {
  if (!uuid.safeParse(dealId).success) return { kind: 'error', message: 'Unknown deal.' };
  if (!input.folder.trim() || !input.displayName.trim()) return { kind: 'error', message: 'Name the source and say which folder to read.' };
  const result = await apiSend<{ id: string }>('POST', `/v1/deals/${dealId}/document-sources`, {
    provider: input.provider,
    mode: input.mode,
    displayName: input.displayName.trim(),
    folder: input.folder.trim(),
    ...(input.token ? { token: input.token.trim() } : {}),
  });
  if (result.kind === 'ok') return { kind: 'ok', id: result.data.id };
  return { kind: 'error', message: sourceProblem(result) };
}

/** Read new and changed files from a connected source. */
export async function syncSource(dealId: string, sourceId: string): Promise<{ kind: 'ok'; files: SourceSyncFile[] } | { kind: 'error'; message: string }> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(sourceId).success) return { kind: 'error', message: 'Unknown source.' };
  const result = await apiSend<{ files: SourceSyncFile[] }>('POST', `/v1/deals/${dealId}/document-sources/${sourceId}/sync`, {});
  if (result.kind === 'ok') return { kind: 'ok', files: result.data.files };
  return { kind: 'error', message: sourceProblem(result) };
}

/** Ask the seller for missing inputs, inside the pact (T-098). */
export async function requestFromSeller(dealId: string, items: readonly string[], note: string): Promise<{ kind: 'ok' } | { kind: 'error'; message: string }> {
  if (!uuid.safeParse(dealId).success) return { kind: 'error', message: 'Unknown deal.' };
  if (items.length === 0) return { kind: 'error', message: 'Nothing is missing to ask for.' };
  const result = await apiSend('POST', `/v1/deals/${dealId}/document-requests`, { items, ...(note.trim() ? { note: note.trim() } : {}) });
  if (result.kind === 'ok') return { kind: 'ok' };
  if (result.kind === 'forbidden') return { kind: 'error', message: 'Only the buyer team can send requests.' };
  return { kind: 'error', message: 'The request was not sent. Try again.' };
}

export async function closeRequest(dealId: string, requestId: string): Promise<{ kind: 'ok' } | { kind: 'error'; message: string }> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(requestId).success) return { kind: 'error', message: 'Unknown request.' };
  const result = await apiSend('POST', `/v1/deals/${dealId}/document-requests/${requestId}/close`, {});
  return result.kind === 'ok' ? { kind: 'ok' } : { kind: 'error', message: 'The request could not be closed.' };
}
