import type { RinseManifest, RinseManifestDocument } from '@pactlab/contracts';
import { HAND_ENTRY_FORMS, handSourcedStamp } from '@pactlab/domain';

/**
 * Injection of a folder finished in Pactlab Rinse (T-178, ADR 0058), pact side. What a manifest brings
 * with its files: the seller's classifications (a proposal, filed through the same intake rules as the
 * AI's), the audit and conversion results, the gap notes, and hand-sourced entries — which arrive as
 * HAND_SOURCED seller claims, never as documents a finding could cite as evidence.
 */
export const RINSE_CLAIM_SOURCE_SUFFIX = ' (Pactlab Rinse; not documentary evidence)';

/** The claims-register source of a hand-sourced entry: who entered it, for which organization, and when. */
export function handSourcedClaimSource(document: RinseManifestDocument): string | null {
  if (!document.handEntry) return null;
  return `${handSourcedStamp(document.handEntry.enteredBy, document.handEntry.enteredAt)}${RINSE_CLAIM_SOURCE_SUFFIX}`.slice(0, 300);
}

/** The claim's statement: the form and every entered value, as the seller entered them. */
export function handSourcedClaimStatement(document: RinseManifestDocument): string | null {
  const entry = document.handEntry;
  if (!entry) return null;
  const form = HAND_ENTRY_FORMS[entry.form];
  const rows = entry.rows.map((row) =>
    form.fields
      .filter((field) => row[field.key] !== undefined)
      .map((field) => `${field.label}: ${field.kind === 'AMOUNT' ? `${entry.currency} ${row[field.key]}` : row[field.key]}`)
      .join('; '),
  );
  const text = `Hand-sourced ${form.label.toLowerCase()} (seller-entered, revision ${entry.revision}) — ${rows.join(' | ')}`;
  return text.length > 1000 ? `${text.slice(0, 997)}...` : text;
}

/**
 * Why the seller's classification is shown on the intake row. The file's provenance (its original, the
 * checks and the conversion audit) is its own record now (T-178d), shown on the document.
 */
export function rinseIntakeReason(document: RinseManifestDocument): string {
  return document.classification?.by === 'PERSON' ? 'Filed as the seller chose it in Pactlab Rinse.' : 'Filed as classified on the seller’s machine in Pactlab Rinse.';
}

export interface RinseSyncSummary {
  readonly status: 'READ' | 'INVALID';
  readonly problem: string | null;
  readonly set: { readonly name: string; readonly pack: string; readonly preparedBy: string; readonly readyAt: string } | null;
  readonly documents: number;
  readonly audited: number;
  readonly handSourced: readonly { readonly title: string; readonly claimId: string | null }[];
  /** Gaps the seller closed with a note, or marked not applicable. */
  readonly notedGaps: readonly { readonly label: string; readonly state: string; readonly note: string | null }[];
  /** Originals that do not foot: diligence signal, not conversion errors. */
  readonly sourceDiscrepancies: readonly { readonly document: string; readonly label: string; readonly page: number; readonly stated: string; readonly computed: string }[];
  /** True when hand-sourced entries wait for the deal team's sync to become claims. */
  readonly claimsWaitForDealTeam: boolean;
  /** Documents filed from the manifest's classifications in this sync: not sent for AI sorting again. */
  readonly filed: readonly string[];
}

export function rinseSummary(manifest: RinseManifest, claims: ReadonlyMap<string, string>, claimsWaitForDealTeam: boolean, filed: readonly string[]): RinseSyncSummary {
  const title = (document: RinseManifestDocument) => document.metadata.title ?? document.converted?.path ?? document.original?.path ?? document.id;
  return {
    status: 'READ',
    problem: null,
    set: { name: manifest.set.name, pack: manifest.set.pack, preparedBy: `${manifest.set.preparedBy.name}, ${manifest.set.preparedBy.organization}`, readyAt: manifest.set.readyAt },
    documents: manifest.documents.length,
    audited: manifest.documents.filter((document) => document.audit !== null).length,
    handSourced: manifest.documents.filter((document) => document.source === 'HAND_ENTRY').map((document) => ({ title: title(document), claimId: claims.get(document.id) ?? null })),
    notedGaps: manifest.gaps.filter((gap) => gap.state === 'NOTED' || gap.state === 'NOT_APPLICABLE').map((gap) => ({ label: gap.label, state: gap.state, note: gap.note })),
    sourceDiscrepancies: manifest.documents.flatMap((document) => (document.audit?.sourceDiscrepancies ?? []).map((discrepancy) => ({ document: title(document), ...discrepancy }))),
    claimsWaitForDealTeam,
    filed,
  };
}
