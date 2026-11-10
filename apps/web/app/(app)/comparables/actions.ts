'use server';

import { COMPARABLE_BATCH_MAX_ROWS, comparableInputSchema, type ComparableBatchPreviewView, type ComparableBatchResultView } from '@pactlab/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { apiSend } from '../deals/_lib/api';

const FIELDS = [
  'kind',
  'name',
  'targetName',
  'acquirerName',
  'announcedOn',
  'companyType',
  'region',
  'enterpriseValue',
  'arr',
  'arrBasis',
  'currency',
  'arrGrowth',
  'nrr',
  'grr',
  'sourceCitation',
  'sourceUrl',
] as const;

const back = (outcome: string): never => redirect(`/comparables?outcome=${outcome}`);

/** Record a comparable entered by a person. The API sets its origin and requires its source. */
export async function addComparable(formData: FormData): Promise<void> {
  const raw = Object.fromEntries(FIELDS.map((field) => [field, formData.get(field) ?? '']));
  const parsed = comparableInputSchema.safeParse(raw);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? '');
    back(`invalid-${FIELDS.includes(field as (typeof FIELDS)[number]) ? field : 'form'}`);
  }
  const result = await apiSend('POST', '/v1/comparables', parsed.data);
  back(result.kind === 'ok' ? 'ok-added' : result.kind);
}

/** Retire a comparable: it stays on record but no benchmark uses it. */
export async function retireComparable(comparableId: string): Promise<void> {
  if (!z.uuid().safeParse(comparableId).success) back('not-found');
  const result = await apiSend('POST', `/v1/comparables/${comparableId}/retire`, {});
  back(result.kind === 'ok' ? 'ok-retired' : result.kind);
}

export type BatchState =
  | { kind: 'idle' }
  | { kind: 'checked'; text: string; preview: ComparableBatchPreviewView }
  | { kind: 'imported'; result: ComparableBatchResultView }
  | { kind: 'error'; message: string };

const BATCH_ERRORS: Record<string, string> = {
  BATCH_EMPTY: 'There are no rows under the header. Paste the header row and at least one comparable.',
  BATCH_TOO_LARGE: `At most ${COMPARABLE_BATCH_MAX_ROWS} rows at a time. Split the file and import it in parts.`,
  BATCH_NOTHING_TO_IMPORT: 'No rows are ready to import. Fix the rows with problems, or tick the duplicates you want to keep.',
};

/** Check, then import, a CSV or pasted batch (T-111). The API parses and validates; nothing is saved on check. */
export async function batchComparables(_previous: BatchState, formData: FormData): Promise<BatchState> {
  const text = String(formData.get('text') ?? '');
  if (text.trim() === '') return { kind: 'error', message: 'Choose a CSV file or paste rows from a spreadsheet first.' };
  if (formData.get('intent') === 'import') {
    const keepDuplicates = formData.getAll('keep').map(Number).filter(Number.isInteger);
    const result = await apiSend<ComparableBatchResultView>('POST', '/v1/comparables/batch', { text, keepDuplicates });
    if (result.kind === 'ok') {
      revalidatePath('/comparables');
      return { kind: 'imported', result: result.data };
    }
    return batchError(result);
  }
  const result = await apiSend<ComparableBatchPreviewView>('POST', '/v1/comparables/batch/preview', { text });
  return result.kind === 'ok' ? { kind: 'checked', text, preview: result.data } : batchError(result);
}

function batchError(result: { kind: string; code?: string }): BatchState {
  if (result.kind === 'invalid') return { kind: 'error', message: (result.code && BATCH_ERRORS[result.code]) ?? 'The rows could not be read. Check the file is a CSV with a header row.' };
  if (result.kind === 'forbidden') return { kind: 'error', message: 'Only organization administrators and deal leads can change the comparables.' };
  return { kind: 'error', message: 'Pactlab could not be reached. Try again in a moment.' };
}
