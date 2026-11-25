'use server';

import { MAX_UPLOAD_BYTES } from '@pactlab/contracts';
import { WITHDRAWAL_REASON_MAX, WITHDRAWAL_REASON_MIN } from '@pactlab/domain';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { dealsApi } from '../../../_lib/api';

const ids = z.strictObject({ dealId: z.uuid(), uploadId: z.uuid() });
const reason = z.string().trim().min(WITHDRAWAL_REASON_MIN).max(WITHDRAWAL_REASON_MAX);

/** Withdraw an import (T-154), then show what it did on the import's own page. */
export async function withdrawImport(deal: string, upload: string, formData: FormData): Promise<void> {
  const parsed = ids.safeParse({ dealId: deal, uploadId: upload });
  if (!parsed.success) redirect('/deals');
  const page = `/deals/${parsed.data.dealId}/sources/upload/${parsed.data.uploadId}`;
  const text = reason.safeParse(formData.get('reason'));
  if (!text.success) redirect(`${page}?withdraw=reason`);
  const result = await dealsApi.withdrawUpload(parsed.data.dealId, parsed.data.uploadId, text.data);
  if (result.kind !== 'ok') redirect(`${page}?withdraw=${result.kind}`);
  const { voidedRecords, flaggedFindings, flaggedValuationRuns } = result.data.result;
  redirect(`${page}?withdrawn=1&voided=${voidedRecords}&findings=${flaggedFindings}&runs=${flaggedValuationRuns}`);
}

/** Re-import a withdrawn import: a corrected file when one is chosen, else the stored original again; then map it. */
export async function reimportImport(deal: string, upload: string, formData: FormData): Promise<void> {
  const parsed = ids.safeParse({ dealId: deal, uploadId: upload });
  if (!parsed.success) redirect('/deals');
  const page = `/deals/${parsed.data.dealId}/sources/upload/${parsed.data.uploadId}`;
  const file = formData.get('file');
  const chosen = file instanceof File && file.size > 0 ? file : null;
  if (chosen && chosen.size > MAX_UPLOAD_BYTES) redirect(`${page}?reimport=too-large`);
  const result = await dealsApi.reimportUpload(
    parsed.data.dealId,
    parsed.data.uploadId,
    chosen ? { fileName: chosen.name || 'upload.csv', body: new Uint8Array(await chosen.arrayBuffer()) } : undefined,
  );
  if (result.kind !== 'ok') redirect(`${page}?reimport=${result.kind}`);
  redirect(`/deals/${parsed.data.dealId}/sources/upload/${result.data.id}`);
}
