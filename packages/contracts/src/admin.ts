import { BUG_SEVERITIES, BUG_STATUSES } from '@pactlab/domain';
import { z } from 'zod';

/** Largest screenshot a report may carry (the app view, masked, PNG or JPEG). */
export const MAX_BUG_SCREENSHOT_BYTES = 1_000_000;

const text = (max: number) => z.preprocess((value) => (typeof value === 'string' && value.trim() === '' ? null : value), z.string().trim().max(max).nullable().default(null));

/** Context the browser attaches without the user typing it. Scrubbed again on the server. */
const clientContext = z
  .strictObject({
    route: z.string().max(500),
    appVersion: z.string().max(80).optional(),
    userAgent: z.string().max(500).optional(),
    viewport: z.string().max(40).optional(),
    environment: z.string().max(20).optional(),
    occurredAt: z.iso.datetime().optional(),
    error: z
      .strictObject({
        name: z.string().max(200),
        message: z.string().max(2000),
        stack: z.string().max(8000).optional(),
        failingRequest: z.string().max(500).optional(),
      })
      .optional(),
    recentConsoleErrors: z.array(z.string().max(1000)).max(10).optional(),
  })
  .partial({ route: true });

export const fileBugReportSchema = z.strictObject({
  trigger: z.enum(['USER_REPORT', 'FRONTEND_EXCEPTION']),
  title: z.string().trim().min(3).max(200),
  whatHappened: text(5000),
  expected: text(5000),
  severity: z.enum(BUG_SEVERITIES),
  dealId: z.preprocess((value) => (value === '' ? null : value), z.uuid().nullable().default(null)),
  context: clientContext.default({}),
  screenshot: z
    .strictObject({
      contentType: z.enum(['image/png', 'image/jpeg']),
      /** Base64 of the image bytes. */
      data: z.string().max(Math.ceil((MAX_BUG_SCREENSHOT_BYTES * 4) / 3) + 4).regex(/^[A-Za-z0-9+/]*={0,2}$/),
    })
    .nullable()
    .default(null),
});
export type FileBugReportInput = z.infer<typeof fileBugReportSchema>;

export const triageBugSchema = z.strictObject({
  status: z.enum(BUG_STATUSES),
  severity: z.enum(BUG_SEVERITIES),
  internalNotes: text(5000),
});
export type TriageBugInput = z.infer<typeof triageBugSchema>;

export const organizationStatusSchema = z.strictObject({ status: z.enum(['ACTIVE', 'SUSPENDED']) });
export const organizationFlagsSchema = z.strictObject({ pilotMode: z.boolean(), liveConnectors: z.boolean() });
export const memberStatusSchema = z.strictObject({ status: z.enum(['ACTIVE', 'SUSPENDED']) });
export const decideOrganizationSchema = z.strictObject({ decision: z.enum(['approve', 'reject']) });
export const usersQuerySchema = z.strictObject({ organizationId: z.uuid().optional(), q: z.string().trim().min(1).max(120).optional() });
export const auditQuerySchema = z.strictObject({ action: z.string().trim().max(60).optional(), since: z.iso.date().optional() });
export const adminBugParamsSchema = z.strictObject({ bugId: z.uuid() });
export const adminOrganizationParamsSchema = z.strictObject({ organizationId: z.uuid() });
export const adminMemberParamsSchema = z.strictObject({ organizationId: z.uuid(), userId: z.uuid() });

export interface BugReportSummaryView {
  id: string;
  reference: string;
  organizationName: string;
  trigger: string;
  title: string;
  severity: string;
  status: string;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  hasScreenshot: boolean;
}

export interface BugReportDetailView extends BugReportSummaryView {
  organizationId: string;
  dealId: string | null;
  reporterUserId: string | null;
  fingerprint: string;
  whatHappened: string | null;
  expected: string | null;
  context: Record<string, unknown>;
  internalNotes: string | null;
}
