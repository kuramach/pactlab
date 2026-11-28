'use server';

import { redirect } from 'next/navigation';
import type { CreatedPrepInvite, PrepInviteView } from '@pactlab/contracts';
import { z } from 'zod';
import { AI_UNAVAILABLE, aiOutcome } from './ai-messages';
import { apiGet, apiSend } from '../../_lib/api';
import { getI18n } from '../../../../../lib/i18n/server';
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
    shared: formData.get('shared') === 'on',
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
      shared: formData.get('shared') === 'on',
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

export type RinseArchiveResult = { kind: 'ok'; files: SourceSyncFile[]; rinse: RinseSyncSummary } | { kind: 'error'; message: string };

const RINSE_ARCHIVE_PROBLEMS: Readonly<Record<string, string>> = {
  RINSE_MANIFEST_MISSING: 'This zip has no pactlab-manifest.json at its top, so it is not a set finished in Pactlab Rinse. Upload it as an ordinary zip instead. Nothing was imported.',
  RINSE_MANIFEST_INVALID: 'The zip’s Pactlab Rinse manifest cannot be read. Ask the seller to rinse the set again. Nothing was imported.',
  ARCHIVE_NOT_A_ZIP: 'This is not a zip file Pactlab can open. Nothing was imported.',
  ARCHIVE_EMPTY: 'The zip has no files in it. Nothing was imported.',
};

/**
 * Import a folder finished in Pactlab Rinse once, as a zip with its manifest (T-178d). The same manifest
 * checks as a connected folder: every file is matched to the manifest by path and SHA-256.
 */
export async function importRinsedArchive(dealId: string, formData: FormData): Promise<RinseArchiveResult> {
  if (!uuid.safeParse(dealId).success) return { kind: 'error', message: 'Unknown deal.' };
  const file = formData.get('file');
  if (!(file instanceof File) || !isArchive(file.name)) return { kind: 'error', message: 'Choose the zip of the finished set.' };
  const checked = checkFile(file.name, file.size);
  if ('problem' in checked) return { kind: 'error', message: UPLOAD_PROBLEMS[checked.problem] };
  const result = await apiSend<{ files: SourceSyncFile[]; rinse: RinseSyncSummary }>('POST', `/v1/deals/${dealId}/rinse-archives`, {
    fileName: file.name,
    contentBase64: Buffer.from(await file.arrayBuffer()).toString('base64'),
    shared: formData.get('shared') === 'on',
  });
  if (result.kind === 'ok') return { kind: 'ok', files: result.data.files, rinse: result.data.rinse };
  if (result.kind === 'invalid') return { kind: 'error', message: (result.code && RINSE_ARCHIVE_PROBLEMS[result.code]) ?? UPLOAD_PROBLEMS.rejected };
  if (result.kind === 'unavailable') return { kind: 'error', message: UPLOAD_PROBLEMS.unavailable };
  if (result.kind === 'forbidden') return { kind: 'error', message: 'You do not have permission to add documents to this deal.' };
  return { kind: 'error', message: 'The zip was not accepted. It may be over 10 MB, hold more than 200 files or unpack to more than 100 MB. Nothing was imported.' };
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

/**
 * Import a spreadsheet already filed here (a rent roll, a P&L) as the pact's data: Pactlab reads it, the
 * mapping assistant proposes the columns, and the mapping screen opens. Nothing is imported until a person confirms.
 */
export async function importDocument(dealId: string, documentId: string, target: string): Promise<{ message: string }> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(documentId).success) return { message: 'Unknown document.' };
  const result = await apiSend<{ id: string }>('POST', `/v1/deals/${dealId}/documents/${documentId}/import`, { target });
  if (result.kind !== 'ok') {
    if (result.kind === 'forbidden') return { message: 'Your role cannot import data on this pact.' };
    return { message: 'This file could not be read as a table. Open it to check, or upload a cleaner export from Sources.' };
  }
  redirect(`/deals/${dealId}/sources/upload/${result.data.id}`);
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
  if (result.kind === 'invalid') return { kind: 'skipped', message: result.code === 'TABLE_DOCUMENT' ? 'A spreadsheet: imported as data instead.' : 'Kept away from AI — no drafts for this document.' };
  if (result.kind === 'unavailable') return { kind: 'error', message: AI_UNAVAILABLE[aiOutcome(result.code)] };
  return { kind: 'error', message: 'AI extraction failed. Use “Re-run AI extraction” on the document to try again.' };
}

export interface CitedQuote {
  documentId: string;
  pageNumber: number;
  quote: string;
}

/** How the AI read a document before extracting (Kumar, 2026-11-25), each part cited to its page. */
export interface DocumentUnderstandingView {
  documentType: string;
  summary: string;
  sections: { title: string; citations: CitedQuote[] }[];
  willExtract: { kind: string; note: string; citations: CitedQuote[] }[];
  questions: { question: string; citations: CitedQuote[] }[];
}

export type UnderstandResult = { kind: 'ok'; understanding: DocumentUnderstandingView } | { kind: 'error'; message: string };

const TABLE_MESSAGE = 'This is a spreadsheet: Pactlab imports it as data instead, so its numbers feed the metrics. Use “Read this spreadsheet”.';

/** Ask the AI to read a document and say how it is set up, before anything is drafted. */
export async function understandOne(dealId: string, documentId: string): Promise<UnderstandResult> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(documentId).success) return { kind: 'error', message: 'Unknown document.' };
  const result = await apiSend<{ understanding: DocumentUnderstandingView | null }>('POST', `/v1/deals/${dealId}/documents/${documentId}/understanding`, {});
  if (result.kind === 'ok') return result.data.understanding ? { kind: 'ok', understanding: result.data.understanding } : { kind: 'error', message: 'The AI could not read this document this time. Try again, or extract straight away.' };
  if (result.kind === 'invalid') return { kind: 'error', message: result.code === 'TABLE_DOCUMENT' ? TABLE_MESSAGE : 'Kept away from AI: nothing is read or drafted from this document.' };
  if (result.kind === 'unavailable') return { kind: 'error', message: AI_UNAVAILABLE[aiOutcome(result.code)] };
  if (result.kind === 'forbidden') return { kind: 'error', message: 'Your role cannot run AI extraction on this pact.' };
  return { kind: 'error', message: 'The AI could not read this document this time. Try again.' };
}

export interface DraftView {
  id: string;
  kind: string;
  subtype: string;
  title: string;
  summary: string;
  severity: string;
  citations: CitedQuote[];
}

export type GuidedExtractResult = { kind: 'ok'; drafted: number; duplicates: number; drafts: DraftView[] } | { kind: 'error'; message: string };

/** Extract with the person's answers as guidance; returns what was drafted, for "What Pactlab picked up". */
export async function extractWithGuidance(dealId: string, documentId: string, guidance: string): Promise<GuidedExtractResult> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(documentId).success) return { kind: 'error', message: 'Unknown document.' };
  const text = guidance.trim().slice(0, 2000);
  const result = await apiSend<{ drafted: number; duplicates: number; drafts: DraftView[] }>('POST', `/v1/deals/${dealId}/documents/${documentId}/extractions`, text ? { guidance: text } : {});
  if (result.kind === 'ok') return { kind: 'ok', drafted: result.data.drafted, duplicates: result.data.duplicates, drafts: result.data.drafts };
  if (result.kind === 'invalid') return { kind: 'error', message: result.code === 'TABLE_DOCUMENT' ? TABLE_MESSAGE : 'Kept away from AI: no drafts for this document.' };
  if (result.kind === 'unavailable') return { kind: 'error', message: AI_UNAVAILABLE[aiOutcome(result.code)] };
  return { kind: 'error', message: 'AI extraction failed. Try again.' };
}

/** Read a document's images again (T-121): after a failure, or a reading a restart stopped. */
export async function readImagesAgain(dealId: string, documentId: string): Promise<{ kind: 'ok' } | { kind: 'error'; message: string }> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(documentId).success) return { kind: 'error', message: 'Unknown document.' };
  const result = await apiSend('POST', `/v1/deals/${dealId}/documents/${documentId}/vision`, {});
  return result.kind === 'ok' ? { kind: 'ok' } : { kind: 'error', message: 'The images could not be read again. Try once more in a minute.' };
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

/** What a pact-wide answer searched and read (T-139): "not found" must never look like "not in the data room". */
export interface AskCoverage {
  strategy: 'FULL' | 'KEYWORD';
  partial: boolean;
  documentsSearched: number;
  pagesSearched: number;
  documentsRead: number;
  pagesRead: number;
  summary: string;
  documents: { documentId: string; documentName: string; pageNumbers: number[] }[];
  moreDocuments: number;
}

export type AskState =
  | { kind: 'idle' }
  | { kind: 'error'; message: string }
  | {
      kind: 'answer';
      question: string;
      status: 'ANSWERED' | 'PARTIAL' | 'UNSUPPORTED' | 'UNANSWERABLE' | 'FAILED';
      answer: string | null;
      claims: { statement: string; citations: { documentId: string; pageNumber: number; quote: string; documentName: string | null }[] }[];
      withheld: number;
      model: string | null;
      coverage: AskCoverage | null;
      /** The documents the question was narrowed to, if it was. */
      narrowedTo: string[];
      /** T-174b: shown beside the answer when it was written in another language than the reader's. */
      languageLabel: string | null;
    };

/** Ask a question across the deal's documents; only cited claims come back. */
export async function askQuestion(dealId: string, _previous: AskState, formData: FormData): Promise<AskState> {
  if (!uuid.safeParse(dealId).success) return { kind: 'error', message: 'Unknown deal.' };
  const question = String(formData.get('question') ?? '').trim();
  if (question.length < 3) return { kind: 'error', message: 'Ask a question of at least a few words.' };
  const documentIds = [...new Set(formData.getAll('documentId').map(String))].filter((id) => uuid.safeParse(id).success).slice(0, 50);
  const result = await apiSend<{
    status: Extract<AskState, { kind: 'answer' }>['status'];
    answer: string | null;
    claims: Extract<AskState, { kind: 'answer' }>['claims'];
    rejectedClaims: unknown[];
    generatedBy: { resolvedModelId: string } | null;
    coverage?: AskCoverage;
    outputLanguage?: { fallback: boolean; label: string | null } | null;
  }>('POST', `/v1/deals/${dealId}/questions`, {
    question,
    ...(documentIds.length > 0 ? { documentIds } : {}),
    // The reader's language (T-174b): the answer is written in it where the model is evaluated in it.
    language: (await getI18n()).locale,
  });
  if (result.kind === 'unavailable') return { kind: 'error', message: AI_UNAVAILABLE[aiOutcome(result.code)] };
  if (result.kind === 'invalid') return { kind: 'error', message: 'There are no documents the AI may read in this deal.' };
  if (result.kind !== 'ok') return { kind: 'error', message: 'The question could not be answered. Try again.' };
  return {
    kind: 'answer',
    question,
    status: result.data.status,
    answer: result.data.answer,
    claims: result.data.claims,
    withheld: result.data.rejectedClaims.length,
    model: result.data.generatedBy?.resolvedModelId ?? null,
    coverage: result.data.coverage ?? null,
    narrowedTo: documentIds,
    languageLabel: result.data.outputLanguage?.fallback ? result.data.outputLanguage.label : null,
  };
}

export interface SourceSyncFile {
  readonly path: string;
  readonly outcome: 'NEW' | 'UPDATED' | 'UNCHANGED' | 'DUPLICATE' | 'REMOVED' | 'SKIPPED' | 'REJECTED' | 'WAITING';
  readonly reason: string | null;
  readonly documentId: string | null;
}

/** What a folder finished in Pactlab Rinse brought with its files (T-178). */
export interface RinseSyncSummary {
  readonly status: 'READ' | 'INVALID';
  readonly problem: string | null;
  readonly set: { readonly name: string; readonly pack: string; readonly preparedBy: string; readonly readyAt: string } | null;
  readonly documents: number;
  readonly audited: number;
  readonly handSourced: readonly { readonly title: string; readonly claimId: string | null }[];
  readonly notedGaps: readonly { readonly label: string; readonly state: string; readonly note: string | null }[];
  readonly sourceDiscrepancies: readonly { readonly document: string; readonly label: string; readonly page: number; readonly stated: string; readonly computed: string }[];
  readonly claimsWaitForDealTeam: boolean;
  readonly filed: readonly string[];
}

const SOURCE_PROBLEMS: Readonly<Record<string, string>> = {
  SOURCE_ACCESS: 'Pactlab could not sign in to this source. Reconnect it in Settings → Document sources (an organization owner or admin), or check the folder is shared with that account.',
  SOURCE_NOT_CONNECTED: 'Your organization has not signed in to this provider yet. An owner or admin connects it once in Settings → Document sources.',
  USE_PICKER: 'Google Drive files are picked in Google’s file picker: use Connect Google Drive.',
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
  if (!input.displayName.trim() || (input.mode === 'FIXTURE' && !input.folder.trim())) return { kind: 'error', message: 'Give it a name.' };
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

/** Where each provider's sign-in lives: the start URL must go there, nowhere else. */
const SIGN_IN_HOSTS = { 'google-drive': 'https://accounts.google.com/', onedrive: 'https://login.microsoftonline.com/' } as const;

/**
 * Connect a folder with one's own Google or Microsoft sign-in (the deal team or the seller): off to the
 * provider, back to this pact, where the folder reads in. Read-only; the sign-in is kept for this folder only.
 */
export async function signInForFolder(dealId: string, input: { provider: 'google-drive' | 'onedrive'; displayName: string; folder: string }): Promise<{ message: string }> {
  if (!uuid.safeParse(dealId).success) return { message: 'Unknown deal.' };
  // Nothing to paste: Google files are picked in Google's picker, a OneDrive folder in Pactlab's chooser, after signing in.
  if (!input.displayName.trim()) return { message: 'Give it a name.' };
  const result = await apiSend<{ url: string }>('POST', `/v1/deals/${dealId}/document-sources/sign-in`, { provider: input.provider, displayName: input.displayName.trim() });
  if (result.kind !== 'ok') return { message: sourceProblem(result) };
  if (!result.data.url.startsWith(SIGN_IN_HOSTS[input.provider])) return { message: 'That sign-in could not be started. Try again.' };
  redirect(result.data.url);
}

/** What Google's picker needs, for the person who connected this Google Drive source: their own short-lived token and Pactlab's picker keys. */
export async function pickerFor(dealId: string, sourceId: string): Promise<{ kind: 'ok'; accessToken: string; apiKey: string; appId: string } | { kind: 'error'; message: string }> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(sourceId).success) return { kind: 'error', message: 'Unknown source.' };
  const result = await apiGet<{ accessToken: string; apiKey: string; appId: string }>(`/v1/deals/${dealId}/document-sources/${sourceId}/picker`);
  if (result.kind === 'ok') return { kind: 'ok', ...result.data };
  if (result.kind === 'forbidden') return { kind: 'error', message: 'Only the person who connected this Google Drive can choose its files.' };
  return { kind: 'error', message: sourceProblem(result) };
}

/** Files chosen in Google's picker join the source; the next sync reads them. */
export async function addChosenFiles(dealId: string, sourceId: string, fileIds: string[]): Promise<{ kind: 'ok'; filesChosen: number } | { kind: 'error'; message: string }> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(sourceId).success || fileIds.length === 0) return { kind: 'error', message: 'Nothing was chosen.' };
  const result = await apiSend<{ filesChosen: number }>('POST', `/v1/deals/${dealId}/document-sources/${sourceId}/files`, { fileIds });
  if (result.kind === 'ok') return { kind: 'ok', filesChosen: result.data.filesChosen };
  return { kind: 'error', message: 'Those files could not be added (a source holds up to 500). Try again.' };
}

export interface DriveFolder {
  readonly driveId: string;
  readonly itemId: string;
  readonly name: string;
  readonly shared: boolean;
}

/** One level of OneDrive folders for the chooser: My files, or inside a folder. */
export async function listFolders(dealId: string, sourceId: string, at?: { driveId: string; itemId: string }): Promise<{ kind: 'ok'; folders: DriveFolder[] } | { kind: 'error'; message: string }> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(sourceId).success) return { kind: 'error', message: 'Unknown source.' };
  const query = at ? `?${new URLSearchParams({ driveId: at.driveId, itemId: at.itemId }).toString()}` : '';
  const result = await apiGet<{ items: DriveFolder[] }>(`/v1/deals/${dealId}/document-sources/${sourceId}/folders${query}`);
  if (result.kind === 'ok') return { kind: 'ok', folders: result.data.items };
  if (result.kind === 'forbidden') return { kind: 'error', message: 'Only the person who connected this OneDrive can choose its folder.' };
  return { kind: 'error', message: 'Your OneDrive folders could not be shown. Try again in a moment.' };
}

/** Use this folder: the source reads it, including files added to it later. */
export async function chooseFolder(dealId: string, sourceId: string, folder: { driveId: string; itemId: string }): Promise<{ kind: 'ok' } | { kind: 'error'; message: string }> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(sourceId).success) return { kind: 'error', message: 'Unknown source.' };
  const result = await apiSend('POST', `/v1/deals/${dealId}/document-sources/${sourceId}/folder`, folder);
  return result.kind === 'ok' ? { kind: 'ok' } : { kind: 'error', message: 'That folder could not be chosen. Try again.' };
}

/** Stop reading a folder: its sign-in is deleted; files already read stay. */
export async function disconnectSource(dealId: string, sourceId: string): Promise<{ kind: 'ok' } | { kind: 'error'; message: string }> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(sourceId).success) return { kind: 'error', message: 'Unknown source.' };
  const result = await apiSend('POST', `/v1/deals/${dealId}/document-sources/${sourceId}/disconnect`, {});
  return result.kind === 'ok' ? { kind: 'ok' } : { kind: 'error', message: result.kind === 'forbidden' ? 'Only the person who connected it, or the deal team, can disconnect it.' : 'It could not be disconnected. Try again.' };
}

/** Read new and changed files from a connected source. */
export async function syncSource(
  dealId: string,
  sourceId: string,
): Promise<{ kind: 'ok'; files: SourceSyncFile[]; waiting: number; complete: boolean; listedLimit: number; rinse: RinseSyncSummary | null } | { kind: 'error'; message: string }> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(sourceId).success) return { kind: 'error', message: 'Unknown source.' };
  const result = await apiSend<{ files: SourceSyncFile[]; waiting: number; complete: boolean; listedLimit: number; rinse?: RinseSyncSummary | null }>('POST', `/v1/deals/${dealId}/document-sources/${sourceId}/sync`, {});
  if (result.kind === 'ok') return { kind: 'ok', files: result.data.files, waiting: result.data.waiting, complete: result.data.complete, listedLimit: result.data.listedLimit, rinse: result.data.rinse ?? null };
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

export type PrepInviteResult = { kind: 'ok'; link: string; email: string; emailSent: boolean } | { kind: 'error'; message: string };

/**
 * A prep invite for a Pactlab Rinse preparer (T-178b): the link creates their free account and binds it
 * to this pact. The link is shown once, here; only its hash is kept.
 */
export async function createPrepInvite(dealId: string, formData: FormData): Promise<PrepInviteResult> {
  if (!uuid.safeParse(dealId).success) return { kind: 'error', message: 'Unknown deal.' };
  const email = z.email().max(254).safeParse(String(formData.get('email') ?? '').trim());
  if (!email.success) return { kind: 'error', message: 'Enter the preparer’s email address.' };
  const result = await apiSend<CreatedPrepInvite>('POST', `/v1/deals/${dealId}/rinse/prep-invites`, { email: email.data });
  if (result.kind === 'ok') return { kind: 'ok', link: result.data.link, email: result.data.invite.email, emailSent: result.data.emailStatus === 'SENT' };
  if (result.kind === 'forbidden') return { kind: 'error', message: 'Only the deal lead and analysts can invite a preparer.' };
  return { kind: 'error', message: 'The invite could not be created. Nothing was sent; try again.' };
}

export async function revokePrepInvite(dealId: string, inviteId: string): Promise<{ kind: 'ok' } | { kind: 'error'; message: string }> {
  if (!uuid.safeParse(dealId).success || !uuid.safeParse(inviteId).success) return { kind: 'error', message: 'Unknown invite.' };
  const result = await apiSend<PrepInviteView>('POST', `/v1/deals/${dealId}/rinse/prep-invites/${inviteId}/revoke`, {});
  if (result.kind === 'ok') return { kind: 'ok' };
  if (result.kind === 'invalid') return { kind: 'error', message: 'This invite is already closed.' };
  return { kind: 'error', message: 'The invite could not be revoked. Try again.' };
}
