import { expectedInputLabel, expectedInputs, type ExpectedInputId } from '../intake/checklist';
import type { PackDefinition } from '../packs/registry';
import type { ConversionAudit } from './audit';
import type { FileInspection } from './files';
import { HAND_ENTRY_FORMS, type HandEntryFormId } from './hand-entry';

/**
 * The rinse loop (T-178): rinse → gaps → fix → re-rinse until clean. Every check result is an error, a
 * warning or information. The set cannot be marked ready with an unresolved error; warnings and noted
 * gaps travel with it, written into the manifest.
 */
export type RinseSeverity = 'ERROR' | 'WARNING' | 'INFO';

export const RINSE_CHECK_CODES = [
  'CORRUPT',
  'LEGACY_FORMAT',
  'UNSUPPORTED_TYPE',
  'EXACT_DUPLICATE',
  'NEAR_DUPLICATE',
  'UNREADABLE_PAGES',
  'NEEDS_VISION',
  'NEEDS_CLASSIFICATION',
  'CONVERSION_MISMATCH',
  'SOURCE_DISCREPANCY',
  'GUIDED_IMPORT',
  'AI_QUEUED',
] as const;
export type RinseCheckCode = (typeof RINSE_CHECK_CODES)[number];

export const RINSE_CHECK_SEVERITY: Readonly<Record<RinseCheckCode, RinseSeverity>> = {
  CORRUPT: 'ERROR',
  LEGACY_FORMAT: 'ERROR',
  UNSUPPORTED_TYPE: 'WARNING',
  EXACT_DUPLICATE: 'WARNING',
  NEAR_DUPLICATE: 'WARNING',
  UNREADABLE_PAGES: 'ERROR',
  NEEDS_VISION: 'WARNING',
  NEEDS_CLASSIFICATION: 'WARNING',
  CONVERSION_MISMATCH: 'ERROR',
  SOURCE_DISCREPANCY: 'WARNING',
  GUIDED_IMPORT: 'INFO',
  AI_QUEUED: 'INFO',
} satisfies Record<RinseCheckCode, RinseSeverity>;

/** How the seller settled a check: removed, replaced, re-run, kept with a note. */
export type CheckResolution = 'EXCLUDED' | 'REPLACED' | 'RERUN' | 'KEPT_WITH_NOTE';

export interface RinseCheck {
  readonly code: RinseCheckCode;
  readonly severity: RinseSeverity;
  readonly message: string;
  readonly resolution: { readonly kind: CheckResolution; readonly note: string | null } | null;
}

export function check(code: RinseCheckCode, message: string): RinseCheck {
  return { code, severity: RINSE_CHECK_SEVERITY[code], message, resolution: null };
}

/** Checks from a file's inspection, its duplicates, its pages and its audit. */
export function fileChecks(input: {
  readonly inspection: FileInspection;
  readonly duplicateOf: { readonly name: string; readonly kind: 'EXACT' | 'NEAR' } | null;
  readonly unreadablePages: readonly number[];
  /** True when the unreadable pages have been read by the vision lane and found legible. */
  readonly visionRead: boolean;
  readonly online: boolean;
  readonly classified: boolean;
  readonly audit: ConversionAudit | null;
}): RinseCheck[] {
  const out: RinseCheck[] = [];
  const { inspection } = input;
  if (inspection.corrupt === 'LEGACY_FORMAT') out.push(check('LEGACY_FORMAT', 'An older Office format: save it as .docx, .xlsx or .pptx and add it again.'));
  else if (inspection.corrupt) out.push(check('CORRUPT', `The file cannot be read (${inspection.corrupt.toLowerCase().replace(/_/g, ' ')}). Replace it with a good copy.`));
  if (inspection.kind === 'UNSUPPORTED') out.push(check('UNSUPPORTED_TYPE', 'Rinse does not read this kind of file; it is left out of the finished set unless you keep it.'));
  if (input.duplicateOf) {
    out.push(check(input.duplicateOf.kind === 'EXACT' ? 'EXACT_DUPLICATE' : 'NEAR_DUPLICATE', `${input.duplicateOf.kind === 'EXACT' ? 'The same file as' : 'Almost the same as'} ${input.duplicateOf.name}. Keep one.`));
  }
  if (inspection.route === 'GUIDED_IMPORT') out.push(check('GUIDED_IMPORT', 'A spreadsheet or statement: kept as it is and packaged for guided import in the pact, never flattened.'));
  if (input.unreadablePages.length > 0 && !input.visionRead) {
    out.push(
      input.online
        ? check('UNREADABLE_PAGES', `Pages ${input.unreadablePages.join(', ')} have no readable text. Re-scan them, or let the vision lane read them.`)
        : check('NEEDS_VISION', `Pages ${input.unreadablePages.join(', ')} have no readable text; they will be read from their images when you are back online.`),
    );
  }
  if (!input.classified) out.push(input.online ? check('NEEDS_CLASSIFICATION', 'Not classified yet: choose what this document is.') : check('AI_QUEUED', 'Classification is queued until you are back online.'));
  for (const mismatch of input.audit?.mismatches ?? []) {
    out.push(check('CONVERSION_MISMATCH', `Conversion mismatch — ${mismatch.label}: the original reads ${mismatch.original.value}${mismatch.original.page ? ` (page ${mismatch.original.page})` : ''}, the conversion ${mismatch.converted.value ?? 'nothing'}${mismatch.converted.page ? ` (page ${mismatch.converted.page})` : ''}.`));
  }
  for (const discrepancy of input.audit?.sourceDiscrepancies ?? []) {
    out.push(check('SOURCE_DISCREPANCY', `The original does not foot — ${discrepancy.label} on page ${discrepancy.page} states ${discrepancy.stated}; its lines sum to ${discrepancy.computed}. It travels as a noted gap.`));
  }
  return out;
}

/** An error stays open until it is resolved; a conversion mismatch is resolved only by fixing or re-running the conversion. */
export function isOpenError(item: RinseCheck): boolean {
  if (item.severity !== 'ERROR') return false;
  if (!item.resolution) return true;
  if (item.code === 'CONVERSION_MISMATCH' || item.code === 'UNREADABLE_PAGES') return !['RERUN', 'REPLACED', 'EXCLUDED'].includes(item.resolution.kind);
  return item.resolution.kind === 'KEPT_WITH_NOTE';
}

export type GapState = 'PRESENT' | 'PRESENT_FLAGGED' | 'HAND_SOURCED' | 'NOT_APPLICABLE' | 'NOTED' | 'MISSING';

export interface RinseGap {
  readonly input: ExpectedInputId;
  readonly label: string;
  readonly need: 'REQUIRED' | 'OPTIONAL';
  readonly state: GapState;
  readonly note: string | null;
  readonly documentIds: readonly string[];
}

export interface GapDocument {
  readonly id: string;
  readonly category: string | null;
  readonly excluded: boolean;
  readonly flagged: boolean;
  readonly handEntry: HandEntryFormId | null;
}

export interface GapResolution {
  readonly input: ExpectedInputId;
  readonly kind: 'NOT_APPLICABLE' | 'NOTED';
  readonly note: string;
}

/**
 * The target pack's expected documents as a checklist: present, present but flagged, hand-sourced,
 * not applicable or noted (both with the seller's note), or missing.
 */
export function rinseGaps(pack: PackDefinition, documents: readonly GapDocument[], resolutions: readonly GapResolution[]): RinseGap[] {
  return expectedInputs(pack)
    .filter((input) => input.id !== 'CODE_AND_DELIVERY')
    .map((input) => {
      const files = documents.filter((document) => !document.excluded && !document.handEntry && document.category === input.id);
      const hand = documents.filter((document) => !document.excluded && document.handEntry && (HAND_ENTRY_FORMS[document.handEntry].covers.includes(input.id) || document.category === input.id));
      const resolution = resolutions.find((entry) => entry.input === input.id) ?? null;
      const base = { input: input.id, label: expectedInputLabel(input.id), need: input.need, note: resolution?.note ?? null };
      if (files.length > 0) return { ...base, state: files.some((file) => file.flagged) ? 'PRESENT_FLAGGED' : 'PRESENT', documentIds: files.map((file) => file.id) };
      if (hand.length > 0) return { ...base, state: 'HAND_SOURCED', documentIds: hand.map((file) => file.id) };
      if (resolution) return { ...base, state: resolution.kind, documentIds: [] };
      return { ...base, state: 'MISSING', documentIds: [] };
    });
}

export interface Readiness {
  readonly ready: boolean;
  readonly openErrors: number;
  readonly warnings: number;
  /** Required inputs still missing with no note. */
  readonly openGaps: readonly ExpectedInputId[];
}

/** Ready only when no error is open and every required gap is closed or carries a note. */
export function rinseReadiness(checks: readonly RinseCheck[], gaps: readonly RinseGap[]): Readiness {
  const openErrors = checks.filter(isOpenError).length;
  const warnings = checks.filter((item) => item.severity === 'WARNING').length;
  const openGaps = gaps.filter((gap) => gap.need === 'REQUIRED' && gap.state === 'MISSING').map((gap) => gap.input);
  return { ready: openErrors === 0 && openGaps.length === 0, openErrors, warnings, openGaps };
}
