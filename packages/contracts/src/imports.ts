import {
  AMOUNT_UNITS,
  BILLING_SYSTEMS,
  DATE_FORMATS,
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
});
export type ImportMappingBody = z.infer<typeof importMappingSchema>;

export const mappingBodySchema = z.strictObject({ mapping: importMappingSchema });

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
});
export type UploadQuery = z.infer<typeof uploadQuerySchema>;

export const uploadParamsSchema = z.strictObject({ dealId: z.uuid(), uploadId: z.uuid() });
export const importTargetParamsSchema = z.strictObject({ dealId: z.uuid(), target: z.enum(IMPORT_TARGETS) });

/** CSV, TSV or Excel files up to 50 MB (200,000 rows). Larger imports run in the background. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** File types an import upload accepts, for the file picker. */
export const IMPORT_FILE_ACCEPT = '.csv,.tsv,.txt,.xlsx,text/csv,text/tab-separated-values,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const sheetBodySchema = z.strictObject({ sheet: z.string().trim().min(1).max(100) });
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
  /** First rows as uploaded, for the mapping screen only; never stored as evidence. */
  sample: string[][];
  suggestedMapping: ImportMappingBody;
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
