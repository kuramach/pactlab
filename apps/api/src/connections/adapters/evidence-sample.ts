import type { NormalizedEvidence } from '@pactlab/domain';

/** Dry-run samples expose normalized fields only; verbatim source text stays server-side. */
export type EvidenceSample = Omit<NormalizedEvidence, 'quote'>;

export function toSample({ quote: _quote, ...record }: NormalizedEvidence): EvidenceSample {
  return record;
}
