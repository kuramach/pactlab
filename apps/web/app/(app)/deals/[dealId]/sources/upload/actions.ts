'use server';

import { importMappingSchema, MAX_UPLOAD_BYTES, uploadQuerySchema, type ImportPreviewView } from '@pactlab/contracts';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { dealsApi } from '../../../_lib/api';

const dealId = z.uuid();

/** Send the chosen file to the API, then open the mapping screen. */
export async function uploadBillingExport(deal: string, formData: FormData): Promise<void> {
  const parsedDeal = dealId.safeParse(deal);
  if (!parsedDeal.success) redirect('/deals');
  const base = `/deals/${parsedDeal.data}/sources/upload`;
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) redirect(`${base}?error=no-file`);
  if (file.size > MAX_UPLOAD_BYTES) redirect(`${base}?error=too-large`);
  const query = uploadQuerySchema.safeParse({ system: formData.get('system'), fileName: file.name || 'billing.csv' });
  if (!query.success) redirect(`${base}?error=no-system`);
  const result = await dealsApi.uploadCsv(
    parsedDeal.data,
    query.data.system,
    query.data.fileName,
    new Uint8Array(await file.arrayBuffer()),
  );
  if (result.kind !== 'ok') redirect(`${base}?error=${result.kind}`);
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

/** Import with the confirmed mapping, then return to Sources with the result. */
export async function importWithMapping(deal: string, upload: string, mapping: unknown): Promise<{ message: string }> {
  const ids = target.safeParse({ dealId: deal, uploadId: upload });
  const parsed = importMappingSchema.safeParse(mapping);
  if (!ids.success || !parsed.success) return { message: 'The mapping is incomplete. Check each field.' };
  const result = await dealsApi.runImport(ids.data.dealId, ids.data.uploadId, parsed.data);
  if (result.kind !== 'ok') {
    const messages: Record<string, string> = {
      invalid: 'Fix the mapping problems before importing.',
      conflict: 'This file was already imported with a different mapping. Upload it again to use a new one.',
      forbidden: 'Your role cannot import data into this deal.',
    };
    return { message: messages[result.kind] ?? 'The import could not run. Try again.' };
  }
  const run = result.data.syncRun;
  if (run.status !== 'SUCCEEDED') return { message: 'The import failed before writing evidence. Try again.' };
  redirect(
    `/deals/${ids.data.dealId}/sources?imported=1&created=${run.recordsCreated}&unchanged=${run.recordsUnchanged}`,
  );
}
