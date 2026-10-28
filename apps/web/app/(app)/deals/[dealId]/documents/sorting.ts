import { classifyOne, extractOne } from './actions';

export type SortStatus = 'filed' | 'needs-you' | 'extracted' | 'not-extracted';

export interface SortOutcome {
  readonly status: SortStatus;
  readonly message: string;
}

/**
 * After a file arrives (upload, zip, data room or seller): the AI files it,
 * then the next step for its kind runs — contracts on to extraction; exports
 * and balance sheets are pointed at their import and reader. When the AI is
 * unsure it asks, under "Pactlab needs you" (T-098).
 */
export async function sortDocument(dealId: string, documentId: string, onExtracting?: (message: string) => void): Promise<SortOutcome> {
  const filed = await classifyOne(dealId, documentId).catch(() => ({ kind: 'error' as const, message: 'Pactlab could not sort this file. Try again from the library.' }));
  if (filed.kind === 'error') return { status: 'not-extracted', message: filed.message };
  if (filed.kind === 'needs-you') return { status: 'needs-you', message: `${filed.question} Answer it under “Pactlab needs you”.` };
  const as = `Filed as ${filed.label.toLowerCase()}${filed.counterpartyName ? ` — ${filed.counterpartyName}` : ''}.`;
  if (filed.route.kind === 'IMPORT') return { status: 'filed', message: `${as} Its rows are imported on Sources.` };
  if (filed.route.kind === 'BALANCE_SHEET') return { status: 'filed', message: `${as} Read its debt and cash on Valuation; nothing reaches the bridge until you confirm it.` };
  if (filed.route.kind === 'FILE') return { status: 'filed', message: as };
  onExtracting?.(as);
  const extracted = await extractOne(dealId, documentId).catch(() => ({ kind: 'error' as const, message: 'AI extraction failed. Use “Re-run AI extraction” on the document to try again.' }));
  if (extracted.kind === 'ok') return { status: 'extracted', message: `${as} ${extracted.drafted} new cited draft(s) in the review queue.` };
  return { status: extracted.kind === 'skipped' ? 'filed' : 'not-extracted', message: `${as} ${extracted.message}` };
}
