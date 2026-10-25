'use server';

import { fileBugReportSchema } from '@pactlab/contracts';
import { apiPost } from '../../deals/_lib/api';

export type FileBugResult = { ok: true; reference: string } | { ok: false; message: string };

/** File a bug report (user-written or an error prompt). The API scrubs and dedups it. */
export async function fileBugReport(input: unknown): Promise<FileBugResult> {
  const parsed = fileBugReportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Give the report a short title (3 characters or more).' };
  const result = await apiPost<{ reference: string }>('/v1/bug-reports', parsed.data);
  if (result.kind === 'ok') return { ok: true, reference: result.data.reference };
  return { ok: false, message: result.kind === 'signed-out' ? 'Your session ended — sign in again to send the report.' : 'The report could not be sent. Try again in a moment.' };
}
