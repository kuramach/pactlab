import {
  AMOUNT_UNITS,
  PNL_KINDS,
  BILLING_SYSTEMS,
  DATE_FORMATS,
  GUIDANCE_MAX_ANNOTATIONS,
  GUIDANCE_MAX_NOTE,
  GUIDANCE_MAX_ROW,
  GUIDANCE_MAX_TEXT,
  IMPORT_TARGET_DEFINITIONS,
  IMPORT_TARGETS,
  NUMBER_FORMATS,
  type ImportTarget,
} from '@pactlab/domain';
import { z } from 'zod';

/** Every canonical field of every import target (billing and pack extracts). */
const FIELD_NAMES = [...new Set(Object.values(IMPORT_TARGET_DEFINITIONS).flatMap((definition) => definition.fields.map((field) => field.name)))] as [string, ...string[]];

export const fieldSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('column'), column: z.string().min(1).max(200) }),
  z.strictObject({ kind: z.literal('constant'), value: z.string().trim().min(1).max(100) }),
  z.strictObject({ kind: z.literal('none') }),
]);

/** How an uploaded export's columns become the Pactlab standard invoice line. */
export const importMappingSchema = z.strictObject({
  target: z.enum(IMPORT_TARGETS),
  fields: z.partialRecord(z.enum(FIELD_NAMES), fieldSourceSchema),
  dateFormat: z.enum(DATE_FORMATS),
  numberFormat: z.enum(NUMBER_FORMATS),
  amountUnit: z.enum(AMOUNT_UNITS),
  negateAmounts: z.boolean(),
  /** How the file is laid out (months across); absent: one record per row. */
  layout: z
    .discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('ROWS') }),
      z.strictObject({ kind: z.literal('PERIOD_COLUMNS'), periods: z.array(z.strictObject({ column: z.string().min(1).max(200), period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) })).min(1).max(60) }),
      z.strictObject({
        kind: z.literal('MONTHS_ACROSS'),
        labelColumn: z.string().min(1).max(200),
        periods: z.array(z.strictObject({ column: z.string().min(1).max(200), period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) })).min(1).max(60),
      }),
    ])
    .optional(),
  /** A P&L: what each account line is. */
  lineKinds: z.record(z.string().min(1).max(200), z.enum(PNL_KINDS)).optional(),
  /** The person accepted subtotals that do not add up to their lines. */
  acceptTieOutGaps: z.boolean().optional(),
});
export type ImportMappingBody = z.infer<typeof importMappingSchema>;

export const mappingBodySchema = z.strictObject({ mapping: importMappingSchema });

/** What a person tells the mapping assistant about a file: free text, and notes on numbered rows (T-152). */
export const importGuidanceSchema = z.strictObject({
  instructions: z.string().max(GUIDANCE_MAX_TEXT),
  annotations: z
    .array(z.strictObject({ fromRow: z.number().int().min(1).max(GUIDANCE_MAX_ROW), toRow: z.number().int().min(1).max(GUIDANCE_MAX_ROW), note: z.string().trim().min(1).max(GUIDANCE_MAX_NOTE) }))
    .max(GUIDANCE_MAX_ANNOTATIONS),
});
export type ImportGuidanceBody = z.infer<typeof importGuidanceSchema>;

export const billingSystemSchema = z.enum(BILLING_SYSTEMS);

export const uploadQuerySchema = z.strictObject({
  /** What the file is imported as; billing when absent, so existing calls are unchanged. */
  target: z.enum(IMPORT_TARGETS).default('BILLING_INVOICE_LINE'),
  /** The billing system a billing export came from; pack extracts use `pactlab_standard`. */
  system: billingSystemSchema,
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[^/\\]+$/, 'A file name, not a path'),
  /** Anything the mapping assistant should know about the file (T-152); the earlier upload's guidance is reused when absent. */
  instructions: z.string().max(GUIDANCE_MAX_TEXT).optional(),
});
export type UploadQuery = z.infer<typeof uploadQuerySchema>;

export const uploadParamsSchema = z.strictObject({ dealId: z.uuid(), uploadId: z.uuid() });
/** Import a spreadsheet already filed in the pact's documents (no second upload). */
export const documentImportParamsSchema = z.strictObject({ dealId: z.uuid(), documentId: z.uuid() });
export const documentImportBodySchema = z.strictObject({ target: z.enum(IMPORT_TARGETS) });
export const importTargetParamsSchema = z.strictObject({ dealId: z.uuid(), target: z.enum(IMPORT_TARGETS) });

/** CSV, TSV or Excel files up to 50 MB (200,000 rows). Larger imports run in the background. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** File types an import upload accepts, for the file picker. */
export const IMPORT_FILE_ACCEPT = '.csv,.tsv,.txt,.xlsx,text/csv,text/tab-separated-values,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Read the upload again: another workbook sheet, or the header on another row (at least one). */
export const sheetBodySchema = z
  .strictObject({ sheet: z.string().trim().min(1).max(100).optional(), headerRow: z.number().int().min(1).max(30).optional(), guidance: importGuidanceSchema.optional() })
  .refine((body) => body.sheet !== undefined || body.headerRow !== undefined || body.guidance !== undefined, 'A sheet, a header row or guidance');
export const importRunParamsSchema = z.strictObject({ dealId: z.uuid(), runId: z.uuid() });

export interface BillingSystemView {
  system: (typeof BILLING_SYSTEMS)[number];
  label: string;
  verified: boolean;
  exportHint: string;
}

export interface SourceUploadView {
  target: ImportTarget;
  id: string;
  system: string;
  fileName: string;
  sizeBytes: number;
  rowCount: number;
  status: 'UPLOADED' | 'IMPORTED' | 'REJECTED' | 'PURGED';
  visibility: 'BUYER_ONLY' | 'SHARED';
  syncRunId: string | null;
  createdAt: string;
  importedAt: string | null;
}

export interface UploadDetailView extends SourceUploadView {
  /** How the file was read: format, text encoding and separator, or the workbook sheet. */
  format: 'CSV' | 'TSV' | 'XLSX';
  encoding: 'UTF-8' | 'WINDOWS-1252' | null;
  delimiter: ',' | ';' | '\t' | null;
  sheet: string | null;
  sheets: string[];
  header: string[];
  /** The header's row among the sheet's non-empty rows; null: the first row. */
  headerRow: number | null;
  /** The sheet's first rows before any header (for choosing the header row); never stored as evidence. */
  preview: string[][];
  /** First rows as uploaded, for the mapping screen only; never stored as evidence. */
  sample: string[][];
  suggestedMapping: ImportMappingBody;
  /** What the mapping assistant filled in and why, and what it asks a person; null for older uploads. */
  assist: {
    source: 'AI' | 'NAMES';
    picks: Record<string, { by: 'AI' | 'NAME' | 'GUIDED'; confidence: number | null; reason: string | null }>;
    questions: { field: string | null; question: string; options: string[] }[];
    unsureLines: string[];
    note: string | null;
    /** What the person told the assistant, quoted back (T-152). */
    guidance?: ImportGuidanceBody | null;
    /** How the assistant read the file, in its words, before anything is mapped; null when no assistant read it. */
    reading?: {
      summary: string | null;
      rowGroups: { from: number; to: number; kind: 'TITLE' | 'HEADER' | 'DATA' | 'SUBTOTAL' | 'NOTES' | 'BLANK'; note: string }[];
    } | null;
  } | null;
  /** The person's instructions and row notes as stored with this upload; null when none were given. */
  guidance: ImportGuidanceBody | null;
  template: BillingSystemView;
}

export interface ImportPreviewView {
  /** Problems with the mapping itself; nothing can import until they are fixed. */
  problems: string[];
  rowCount: number;
  validRows: number;
  issues: { code: string; count: number; rows: number[]; detail: string }[];
  sample: Record<string, string | null>[];
  /** Sum of amounts per currency over valid rows, as decimal strings. */
  totals: { currency: string; amount: string; lines: number }[];
  /** Fields left empty on some valid rows; the revenue engine will explain exclusions. */
  emptyFields: { field: string; rows: number }[];
  /** A P&L: subtotals that do not add up to their lines, per month (decimal strings). */
  tieOut: { account: string; month: string; kind: string; stated: string; computed: string }[];
  /** A P&L: every account still without a line kind. */
  unclassified: string[];
}

export interface ImportResultView {
  upload: SourceUploadView;
  syncRun: {
    id: string;
    status: string;
    recordsSeen: number;
    recordsCreated: number;
    recordsUnchanged: number;
    issuesCount: number;
  };
  replayed: boolean;
  /** True when the import runs in the background; poll its progress by run id. */
  background: boolean;
}

/**
 * What an import picked up (Kumar, 2026-11-25: "After the extraction, it shd show me what it picked up, what metrics
 * it derived and how it will show"): its counts, its first records in the field labels, which metrics read it, a
 * P&L's monthly totals (computed by code from the lines), and the draft findings the industry checks raised from it.
 */
export interface ImportResultsView {
  status: string;
  run: { status: string; recordsSeen: number; recordsCreated: number; recordsUnchanged: number; issuesCount: number };
  /** Records this import holds that still count (none once it is deleted). */
  activeRecords: number;
  /** Its first records, field by field; null for a file about people (counts only). */
  sample: { fields: { name: string; label: string }[]; rows: (string | null)[][] } | null;
  /** Which metrics read this kind of data: the subscription metrics, the industry pack's, or none. */
  metrics: 'SUBSCRIPTION' | 'INDUSTRY' | null;
  /** A P&L: what its lines add up to, month by month (decimal strings, costs positive). */
  pnlMonths: { month: string; revenue: string; costOfRevenue: string; grossProfit: string; operatingExpenses: string; operatingIncome: string; netIncome: string }[] | null;
  /** Findings that cite this import's records (the buyer's side only; null for a counterparty). */
  findings: number | null;
}

/** How far an import run has got. Counts only. */
export interface ImportProgressView {
  syncRunId: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  phase: 'QUEUED' | 'READING' | 'VALIDATING' | 'WRITING' | 'DONE';
  processed: number;
  total: number | null;
  recordsCreated: number;
  recordsUnchanged: number;
  /** Error class name when the run failed; never row contents. */
  errorClass: string | null;
}

/** A CSV import target the deal's pack offers (ADR 0010), with its standard template. */
export interface ImportTargetView {
  target: ImportTarget;
  label: string;
  fileName: string;
  people: 'NONE' | 'AGGREGATE' | 'PSEUDONYMOUS';
  fields: { name: string; label: string; required: boolean; hint: string }[];
  templateCsv: string;
}
