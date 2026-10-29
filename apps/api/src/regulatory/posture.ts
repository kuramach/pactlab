import { orderPosture, summarizePosture, type PostureSignal } from '@pactlab/calculations';
import type { DocumentCitation } from '@pactlab/domain';

/**
 * Posture entries (T-091) as signals, newest first, each with where it is
 * cited, and what they say together. The regulatory screen and Foresight's
 * government-posture trend both read this: one record, not two.
 */
export function postureView(entries: readonly { id: string; payload: unknown; citation: DocumentCitation }[]) {
  const signals = orderPosture(
    entries.map((entry) => ({ ...(entry.payload as Omit<PostureSignal, 'id'>), id: entry.id, citation: { documentId: entry.citation.documentId, pageNumber: entry.citation.pageNumber } })),
  );
  return { summary: summarizePosture(signals), signals };
}
