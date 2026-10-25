'use server';

import { importMappingSchema, MAX_UPLOAD_BYTES, uploadQuerySchema, type ImportPreviewView, type ImportProgressView } from '@pactlab/contracts';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { dealsApi } from '../../../_lib/api';
import { importedUrl } from './_lib/mapping-form';

const dealId = z.uuid();

/** Send the chosen file to the API, then open the mapping screen. */
export async function uploadBillingExport(deal: string, formData: FormData): Promise<void> {
  const parsedDeal = dealId.safeParse(deal);
  if (!parsedDeal.success) redirect('/deals');
  const base = `/deals/${parsedDeal.data}/sources/upload`;
  // Pack extracts (ADR 0010) carry their target and use the Pactlab standard template; billing chooses a system.
  const targetField = formData.get('target');
  const packTarget = typeof targetField === 'string' && /^[A-Z][A-Z0-9_]{1,60}$/.test(targetField) && targetField !== 'BILLING_INVOICE_LINE' ? targetField : undefined;
  const back = packTarget ? `${base}?target=${packTarget}&` : `${base}?`;
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) redirect(`${back}error=no-file`);
  if (file.size > MAX_UPLOAD_BYTES) redirect(`${back}error=too-large`);
  const query = uploadQuerySchema.safeParse({
    system: packTarget ? 'pactlab_standard' : formData.get('system'),
    fileName: file.name || 'upload.csv',
    ...(packTarget ? { target: packTarget } : {}),
  });
  if (!query.success) redirect(`${back}error=no-system`);
  const result = await dealsApi.uploadCsv(
    parsedDeal.data,
    query.data.system,
    query.data.fileName,
    new Uint8Array(await file.arrayBuffer()),
    packTarget ? query.data.target : undefined,
  );
  if (result.kind !== 'ok') redirect(`${back}error=${result.kind}`);
  redirect(`${base}/${result.data.id}`);
}

const target = z.strictObject({ dealId: z.uuid(), uploadId: z.uuid() });

export type PreviewState = { kind: 'idle' } | { kind: 'ok'; preview: ImportPreviewView } | { kind: 'error'; message: string };

/** Dry run of a mapping. The API re-validates and writes nothing. */
export async function previewMapping(deal: string, upload: string, mapping: unknown): Promise<PreviewState> {
  const ids = target.safeParse({ dealId: deal, uploadId: upload });
  const parsed = importMappingSchema.safeParse(mapping);
  if (!ids.success || !parsed.success) return { kind: 'error', message: 'The mapping is incomplete. Check each field.' };
  const result = await dealsApi.previewImport(ids.data.dealId, ids.data.uploadId, parsed.data);
  if (result.kind === 'ok') return { kind: 'ok', preview: result.data };
  return { kind: 'error', message: result.kind === 'forbidden' ? 'Your role cannot import data into this deal.' : 'The check could not run. Try again.' };
}

export type ImportOutcome = { kind: 'message'; message: string } | { kind: 'background'; runId: string };

/** Import with the confirmed mapping, then return to Sources with the result — or, for a large file, follow it in the background. */
export async function importWithMapping(deal: string, upload: string, mapping: unknown): Promise<ImportOutcome> {
  const ids = target.safeParse({ dealId: deal, uploadId: upload });
  const parsed = importMappingSchema.safeParse(mapping);
  if (!ids.success || !parsed.success) return { kind: 'message', message: 'The mapping is incomplete. Check each field.' };
  const result = await dealsApi.runImport(ids.data.dealId, ids.data.uploadId, parsed.data);
  if (result.kind !== 'ok') {
    const messages: Record<string, string> = {
      invalid: 'Fix the mapping problems before importing.',
      conflict: 'This file was already imported with a different mapping. Upload it again to use a new one.',
      forbidden: 'Your role cannot import data into this deal.',
    };
    return { kind: 'message', message: messages[result.kind] ?? 'The import could not run. Try again.' };
  }
  const run = result.data.syncRun;
  if (run.status === 'QUEUED' || run.status === 'RUNNING') return { kind: 'background', runId: run.id };
  if (run.status !== 'SUCCEEDED') return { kind: 'message', message: 'The import failed before writing evidence. Try again.' };
  redirect(importedUrl(ids.data.dealId, result.data.upload.target, run, result.data.replayed));
}

const runIds = z.strictObject({ dealId: z.uuid(), runId: z.uuid() });

/** How far a background import has got (counts only); polled by the mapping screen. */
export async function importProgressOf(deal: string, run: string): Promise<ImportProgressView | null> {
  const ids = runIds.safeParse({ dealId: deal, runId: run });
  if (!ids.success) return null;
  const result = await dealsApi.importProgress(ids.data.dealId, ids.data.runId);
  return result.kind === 'ok' ? result.data : null;
}

/** Read another sheet of an Excel upload; the page then shows its columns. */
export async function chooseSheet(deal: string, upload: string, sheet: string): Promise<{ message: string | null }> {
  const ids = target.safeParse({ dealId: deal, uploadId: upload });
  const name = z.string().trim().min(1).max(100).safeParse(sheet);
  if (!ids.success || !name.success) return { message: 'Choose a sheet.' };
  const result = await dealsApi.selectSheet(ids.data.dealId, ids.data.uploadId, name.data);
  if (result.kind === 'ok') return { message: null };
  return { message: result.kind === 'conflict' ? 'This upload was already imported; its sheet is fixed.' : 'That sheet could not be read. Try another.' };
}

/** Discard an upload that was the wrong file: nothing is imported, the stored copy is deleted (audited). */
export async function cancelUpload(deal: string, upload: string): Promise<{ message: string }> {
  const ids = target.safeParse({ dealId: deal, uploadId: upload });
  if (!ids.success) return { message: 'This upload cannot be cancelled.' };
  const result = await dealsApi.cancelUpload(ids.data.dealId, ids.data.uploadId);
  if (result.kind !== 'ok') {
    const messages: Record<string, string> = {
      conflict: 'This file is already imported; its records stay as evidence. Upload a corrected file instead.',
      forbidden: 'Your role cannot change uploads on this deal.',
    };
    return { message: messages[result.kind] ?? 'The upload could not be cancelled. Try again.' };
  }
  redirect(`/deals/${ids.data.dealId}/sources?cancelled=1`);
}
