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

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

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
