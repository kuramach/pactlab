import {
  HAND_ENTRY_FORM_IDS,
  HAND_ENTRY_VERSION,
  RINSE_AUDIT_VERSION,
  RINSE_CHECK_CODES,
} from '@pactlab/domain';
import { z } from 'zod';

/**
 * `pactlab-manifest.json` (T-178, ADR 0058): written by Pactlab Rinse beside the finished set, read by
 * the pact at sync or import. It is untrusted input on the pact side: every path is relative and inside
 * the folder, every file is named by its SHA-256, and the schema rejects unknown fields.
 */
export const RINSE_MANIFEST_FILE = 'pactlab-manifest.json';
export const RINSE_MANIFEST_SCHEMA = 'pactlab-rinse-manifest';
export const RINSE_MANIFEST_VERSION = 1;
/** Largest manifest the pact reads. */
export const MAX_RINSE_MANIFEST_BYTES = 5 * 1024 * 1024;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.iso.datetime({ offset: true });
const text = (max: number) => z.string().trim().min(1).max(max);
/** A path inside the finished folder: `/`-separated, relative, no `..`, no empty segment. */
export const rinsePathSchema = z
  .string()
  .max(500)
  .refine((path) => path.length > 0 && !path.startsWith('/') && !path.includes('\\') && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..'), 'A relative path inside the folder');
const decimal = z.string().regex(/^-?\d+(\.\d+)?$/);

const fileRefSchema = z.strictObject({
  path: rinsePathSchema,
  sha256,
  sizeBytes: z.number().int().min(0).max(1024 ** 3),
  mediaType: text(120),
});

const personSchema = z.strictObject({
  userId: z.uuid(),
  name: text(200),
  organization: text(200),
});

const checkSchema = z.strictObject({
  code: z.enum(RINSE_CHECK_CODES),
  severity: z.enum(['ERROR', 'WARNING', 'INFO']),
  message: text(1000),
  resolution: z.strictObject({ kind: z.enum(['EXCLUDED', 'REPLACED', 'RERUN', 'KEPT_WITH_NOTE']), note: z.string().max(1000).nullable() }).nullable(),
});

const sideSchema = z.strictObject({ value: z.string().max(500).nullable(), page: z.number().int().min(1).nullable() });

const auditSchema = z.strictObject({
  version: z.literal(RINSE_AUDIT_VERSION),
  /** How the original was re-read: its own text layer, or the vision lane from its images. */
  originalReadBy: z.enum(['TEXT_LAYER', 'VISION']),
  figuresCompared: z.number().int().min(0),
  figuresMatched: z.number().int().min(0),
  pages: z.strictObject({ original: z.number().int().min(0), converted: z.number().int().min(0) }),
  tables: z.strictObject({ original: z.number().int().min(0), converted: z.number().int().min(0) }),
  mismatches: z
    .array(
      z.strictObject({
        kind: z.enum(['FIGURE', 'PAGE_COUNT', 'TABLE_MISSING', 'FIGURE_MISSING', 'DATE', 'PARTY', 'FOOTING']),
        label: text(300),
        original: sideSchema,
        converted: sideSchema,
        /** How the mismatch was settled before ready: the conversion re-run or fixed, or the file replaced. */
        resolution: z.enum(['RERUN', 'FIXED', 'REPLACED']),
      }),
    )
    .max(500),
  sourceDiscrepancies: z.array(z.strictObject({ label: text(300), page: z.number().int().min(1), stated: decimal, computed: decimal })).max(500),
});

const conversionStepSchema = z.strictObject({
  at: timestamp,
  step: z.enum(['INSPECTED', 'CONVERTED', 'NORMALIZED', 'TEXT_EXTRACTED', 'VISION_READ', 'AUDITED', 'GENERATED', 'PACKAGED_FOR_IMPORT', 'CLASSIFIED']),
  tool: text(120),
  detail: z.string().max(500).nullable(),
});

const handEntrySchema = z.strictObject({
  form: z.enum(HAND_ENTRY_FORM_IDS),
  formVersion: z.literal(HAND_ENTRY_VERSION),
  /** The values as entered (amounts normalised to plain decimals), one object per row. */
  rows: z.array(z.record(z.string().max(60), z.string().max(500))).min(1).max(500),
  currency: z.string().regex(/^[A-Z]{3}$/),
  enteredBy: personSchema,
  enteredAt: timestamp,
  /** Edits before upload are versions; the latest is what travels. */
  revision: z.number().int().min(1),
});

export const rinseDocumentSchema = z
  .strictObject({
    id: z.uuid(),
    /** FILE: the seller's own file. HAND_ENTRY: generated from values entered by hand — a claim, never evidence. */
    source: z.enum(['FILE', 'HAND_ENTRY']),
    /** The seller's file, unmodified. Absent for a hand entry. */
    original: fileRefSchema.nullable(),
    /** The canonical form: normalized PDF with a text layer and stable page anchors. */
    converted: fileRefSchema.extend({ pages: z.number().int().min(1).max(5000), anchors: z.array(z.string().regex(/^p\d{1,4}$/)).max(5000) }).nullable(),
    route: z.enum(['CONVERT', 'GUIDED_IMPORT', 'NONE']),
    classification: z
      .strictObject({ category: text(80), by: z.enum(['AI', 'PERSON']), confidence: z.number().min(0).max(1).nullable(), promptVersion: z.string().max(80).nullable() })
      .nullable(),
    metadata: z.strictObject({ title: z.string().max(300).nullable(), dates: z.array(z.string().max(40)).max(50), parties: z.array(z.string().max(200)).max(50) }),
    checks: z.array(checkSchema).max(200),
    conversionLog: z.array(conversionStepSchema).max(100),
    audit: auditSchema.nullable(),
    handEntry: handEntrySchema.nullable(),
    duplicateOf: z.uuid().nullable(),
  })
  .refine((document) => (document.source === 'FILE' ? document.original !== null && document.handEntry === null : document.handEntry !== null && document.converted !== null), 'A file has an original; a hand entry has its generated document');

export const rinseGapSchema = z.strictObject({
  input: text(80),
  label: text(200),
  need: z.enum(['REQUIRED', 'OPTIONAL']),
  state: z.enum(['PRESENT', 'PRESENT_FLAGGED', 'HAND_SOURCED', 'NOT_APPLICABLE', 'NOTED', 'MISSING']),
  note: z.string().max(1000).nullable(),
  documentIds: z.array(z.uuid()).max(500),
});

export const rinseManifestSchema = z
  .strictObject({
    schema: z.literal(RINSE_MANIFEST_SCHEMA),
    version: z.literal(RINSE_MANIFEST_VERSION),
    generator: z.strictObject({ app: z.literal('Pactlab Rinse'), version: z.string().regex(/^\d+\.\d+\.\d+$/) }),
    set: z.strictObject({
      id: z.uuid(),
      name: text(200),
      /** The seller's company type the expected-document list came from. */
      pack: text(60),
      createdAt: timestamp,
      readyAt: timestamp,
      /** The preparer's verified Pactlab identity: the login that makes the upload trustworthy. */
      preparedBy: personSchema,
      /**
       * The pact a prep invite bound the set to, when one did. `bindingId` (T-178b) names the preparer's
       * binding; the sync checks it is live for the pact it syncs into, and refuses a set bound elsewhere.
       */
      intendedPact: z.strictObject({ organizationId: z.uuid(), dealId: z.uuid(), bindingId: z.uuid().optional() }).nullable(),
    }),
    documents: z.array(rinseDocumentSchema).max(5000),
    gaps: z.array(rinseGapSchema).max(200),
  })
  .superRefine((manifest, context) => {
    const ids = new Set(manifest.documents.map((document) => document.id));
    if (ids.size !== manifest.documents.length) context.addIssue({ code: 'custom', message: 'Document ids are unique' });
    // Only a ready set is ever written: no unresolved error travels, and no required gap is open.
    const open = manifest.documents.some((document) => document.checks.some((item) => item.severity === 'ERROR' && (!item.resolution || item.resolution.kind === 'KEPT_WITH_NOTE')));
    if (open) context.addIssue({ code: 'custom', message: 'A ready set carries no unresolved error' });
    if (manifest.gaps.some((gap) => gap.need === 'REQUIRED' && gap.state === 'MISSING')) context.addIssue({ code: 'custom', message: 'A ready set has no open required gap' });
    for (const gap of manifest.gaps) for (const id of gap.documentIds) if (!ids.has(id)) context.addIssue({ code: 'custom', message: 'A gap names documents in the set' });
  });

export type RinseManifest = z.infer<typeof rinseManifestSchema>;
export type RinseManifestDocument = z.infer<typeof rinseDocumentSchema>;
export type RinseManifestGap = z.infer<typeof rinseGapSchema>;

/** Parse the bytes of a manifest; null with a reason when it is not one the pact can read. */
export function parseRinseManifest(bytes: Uint8Array): { manifest: RinseManifest; problem: null } | { manifest: null; problem: 'TOO_LARGE' | 'NOT_JSON' | 'INVALID' } {
  if (bytes.byteLength > MAX_RINSE_MANIFEST_BYTES) return { manifest: null, problem: 'TOO_LARGE' };
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return { manifest: null, problem: 'NOT_JSON' };
  }
  const parsed = rinseManifestSchema.safeParse(raw);
  return parsed.success ? { manifest: parsed.data, problem: null } : { manifest: null, problem: 'INVALID' };
}

/** The parts of a manifest entry the pact keeps as the document's provenance (T-178d): never metadata read from the content. */
export function rinseProvenanceEntry(document: RinseManifestDocument) {
  return { route: document.route, classification: document.classification, checks: document.checks, conversionLog: document.conversionLog, audit: document.audit, duplicateOf: document.duplicateOf };
}
export type RinseProvenanceEntry = ReturnType<typeof rinseProvenanceEntry>;

/** A document's provenance from a rinsed set, as the pact shows it on the document and its citations. */
export interface DocumentProvenanceView {
  documentId: string;
  set: { id: string; name: string; preparedBy: { name: string; organization: string }; readyAt: string; origin: 'SYNC' | 'ARCHIVE' };
  role: 'CONVERTED' | 'AS_IS';
  manifestDocumentId: string;
  canonical: { path: string; sha256: string };
  /** The seller's original, left at the source; null for a file carried as it is. */
  original: { path: string; sha256: string; sizeBytes: number | null; mediaType: string | null } | null;
  entry: RinseProvenanceEntry;
  recordedAt: string;
}

/** A source discrepancy as stored on its set: the original does not foot. */
export interface RinseSourceDiscrepancy {
  manifestDocumentId: string;
  /** The pact document of its canonical copy, when one came in. */
  documentId: string | null;
  title: string;
  label: string;
  page: number;
  stated: string;
  computed: string;
}

/** A rinsed set as it reached the pact: the gap notes and source discrepancies, with the drafts they became. */
export interface RinseSetView {
  id: string;
  name: string;
  pack: string;
  preparedBy: { name: string; organization: string };
  readyAt: string;
  origin: 'SYNC' | 'ARCHIVE';
  documents: number;
  gaps: RinseManifestGap[];
  sourceDiscrepancies: (RinseSourceDiscrepancy & { findingId: string | null })[];
  recordedAt: string;
}

// ---------------------------------------------------------------------------
// Preparer accounts, prep invites and AI rinse jobs (T-178b, ADR 0059)
// ---------------------------------------------------------------------------

/** A prep invite token: 32 random bytes, base64url. */
export const prepInviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const createPrepInviteSchema = z.strictObject({ email: z.email().max(254) });
export type CreatePrepInviteBody = z.infer<typeof createPrepInviteSchema>;

export interface PrepInviteView {
  id: string;
  email: string;
  state: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  /** The preparer's binding once accepted, and whether it still stands. */
  binding: { id: string; boundAt: string; revokedAt: string | null } | null;
}

/** Returned once, when the invite is created: the link and QR text are never readable again. */
export interface CreatedPrepInvite {
  invite: PrepInviteView;
  link: string;
  emailStatus: 'SENT' | 'NOT_SENT';
}

export const prepInviteTokenBodySchema = z.strictObject({ token: prepInviteTokenSchema });

export const preparerStartSchema = z.strictObject({ token: prepInviteTokenSchema, email: z.email().max(254), displayName: z.string().trim().min(1).max(120) });
export const preparerVerifySchema = z.strictObject({
  token: prepInviteTokenSchema,
  email: z.email().max(254),
  code: z.string().regex(/^\d{6}$/),
  /** The desktop keeps the session for offline use: up to 30 days, within the workspace's cap. */
  trust: z.enum(['8h', '1d', '1w', '30d']).default('1w'),
  device: z.string().trim().min(1).max(80).optional(),
});

export interface PrepInvitePreview {
  pactName: string;
  invitedBy: string;
  email: string;
  expiresAt: string;
  state: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
}

export interface PreparerBindingView {
  bindingId: string;
  organizationId: string;
  dealId: string;
  pactName: string;
  invitedBy: string;
  boundAt: string;
}

export interface PreparerSession {
  token: string;
  expiresAt: string;
  bindings: PreparerBindingView[];
}

const pageText = z.string().max(12_000);
export const rinseClassifySchema = z.strictObject({
  bindingId: z.uuid(),
  /** The seller's company type the expected-document list comes from (the manifest's `set.pack`). */
  pack: z.string().min(1).max(60),
  fileName: z.string().min(1).max(300),
  folder: z.string().max(500).nullable().default(null),
  pageTexts: z.array(pageText).min(1).max(3),
});
export type RinseClassifyBody = z.infer<typeof rinseClassifySchema>;

export interface RinseClassifyResult {
  category: string;
  confidence: number;
  promptVersion: string;
  /** A people-data category (HR, compensation): the desktop never sends the file to the vision lane. */
  aiExcluded: boolean;
}

export const rinseVisionSchema = z.strictObject({
  bindingId: z.uuid(),
  fileName: z.string().min(1).max(300),
  page: z.number().int().min(1).max(5000),
  image: z.strictObject({ format: z.enum(['png', 'jpeg']), base64: z.string().min(4).max(7_000_000) }),
});
export type RinseVisionBody = z.infer<typeof rinseVisionSchema>;

export interface RinseVisionResult {
  text: string | null;
  promptVersion: string;
}
