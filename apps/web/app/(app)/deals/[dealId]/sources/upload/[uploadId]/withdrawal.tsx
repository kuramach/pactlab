import { WITHDRAWAL_CONSEQUENCES, WITHDRAWAL_REASON_MAX, WITHDRAWAL_REASON_MIN, type ImportLineageEntry } from '@pactlab/domain';
import { Badge, Button } from '@pactlab/ui';
import Link from 'next/link';
import { reimportImport, withdrawImport } from '../withdrawal-actions';

const inputClass = 'w-full rounded-md border border-border bg-background px-2 py-1 text-sm';
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
const count = new Intl.NumberFormat('en-US');

/** What failed, in words (T-125): never a code. */
const FAILURES: Record<string, string> = {
  reason: `Give a reason of ${WITHDRAWAL_REASON_MIN} to ${WITHDRAWAL_REASON_MAX} characters.`,
  invalid: `Give a reason of ${WITHDRAWAL_REASON_MIN} to ${WITHDRAWAL_REASON_MAX} characters.`,
  forbidden: 'Only the person who imported this file, the deal lead or an analyst can delete it or import it again.',
  conflict: 'This import changed in the meantime (already deleted or imported again). Refresh to see where it stands.',
  'too-large': 'The corrected file is larger than 50 MB.',
};
export const withdrawalFailure = (kind: string | undefined) => (kind ? (FAILURES[kind] ?? 'That did not go through; nothing changed. Try again.') : null);

/**
 * Delete (withdraw) an import (T-154): a confirmation that says plainly what happens, and a reason.
 * Shown to whoever imported it, and to the deal lead and analysts (Kumar, 2026-11-25); the API decides.
 * Open when the person came here to delete it.
 */
export function WithdrawPanel({ dealId, uploadId, open = false }: { dealId: string; uploadId: string; open?: boolean }) {
  return (
    <details id="delete" open={open} className="rounded-md border border-border px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">Delete this import</summary>
      <form action={withdrawImport.bind(null, dealId, uploadId)} className="mt-3 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <p className="font-medium">Deleting it means:</p>
          <ul className="list-disc pl-5 text-muted-foreground">
            {WITHDRAWAL_CONSEQUENCES.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="text-muted-foreground">You can import it again straight after: a corrected file, or this one read another way.</p>
        </div>
        <label className="flex flex-col gap-1">
          Why are you deleting it?
          <textarea name="reason" required minLength={WITHDRAWAL_REASON_MIN} maxLength={WITHDRAWAL_REASON_MAX} rows={2} placeholder="e.g. Columns were read wrongly; importing again" className={inputClass} />
        </label>
        <div>
          <Button type="submit" size="sm" variant="destructive">
            Delete import
          </Button>
        </div>
      </form>
    </details>
  );
}

/** A deleted (withdrawn) import: who, when and why; its chain of re-imports; and the way to import it again. */
export function WithdrawnPanel({
  dealId,
  uploadId,
  chain,
  supersededByUploadId,
  canManage,
  done,
}: {
  dealId: string;
  uploadId: string;
  chain: readonly ImportLineageEntry[] | null;
  supersededByUploadId: string | null;
  canManage: boolean;
  done: { voided: number; findings: number; runs: number } | null;
}) {
  return (
    <section aria-labelledby="withdrawn" className="flex flex-col gap-3">
      {done ? (
        <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Deleted. {count.format(done.voided)} records no longer count. {done.findings === 0 && done.runs === 0 ? 'Nothing had been built on them yet.' : `${count.format(done.findings)} findings and ${count.format(done.runs)} valuation runs that used them are now flagged "source withdrawn".`}
        </p>
      ) : null}
      <h3 id="withdrawn" className="text-base font-semibold">
        This import was deleted
      </h3>
      <p className="text-sm text-muted-foreground">
        Its data no longer counts anywhere in this pact. Pactlab keeps a note that it was imported and deleted, so numbers seen before can still be explained.
      </p>
      {chain ? <ImportHistory dealId={dealId} chain={chain} current={uploadId} /> : null}
      {supersededByUploadId ? (
        <p className="text-sm">
          Re-imported as{' '}
          <Link href={`/deals/${dealId}/sources/upload/${supersededByUploadId}`} className="font-semibold underline">
            the next version
          </Link>
          .
        </p>
      ) : canManage ? (
        <form action={reimportImport.bind(null, dealId, uploadId)} className="flex flex-col gap-2 rounded-md border border-border px-3 py-2 text-sm">
          <p className="font-medium">Import this file again</p>
          <p className="text-muted-foreground">Leave the file empty to read this same file again, or choose a corrected one. The columns you confirmed before are offered again where they still fit.</p>
          <input type="file" name="file" accept=".csv,.tsv,.txt,.xlsx" aria-label="Corrected file (optional)" className="text-sm" />
          <div>
            <Button type="submit" size="sm">
              Import again
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

const STATUS_LABELS: Record<ImportLineageEntry['status'], string> = { UPLOADED: 'Not imported yet', IMPORTED: 'Active', WITHDRAWN: 'Deleted', PURGED: 'Cancelled', REJECTED: 'Rejected' };

/** The chain of versions: v1 withdrawn (reason) → v2 active. */
export function ImportHistory({ dealId, chain, current }: { dealId: string; chain: readonly ImportLineageEntry[]; current: string }) {
  return (
    <ol aria-label="Import history" className="flex flex-col gap-2 text-sm">
      {chain.map((entry) => (
        <li key={entry.uploadId} className="flex flex-col gap-0.5 rounded-md border border-border px-3 py-2">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">v{entry.version}</span>
            {entry.uploadId === current ? <span className="font-medium">{entry.fileName}</span> : (
              <Link href={`/deals/${dealId}/sources/upload/${entry.uploadId}`} className="underline">
                {entry.fileName}
              </Link>
            )}
            <Badge variant={entry.status === 'WITHDRAWN' ? 'danger' : entry.status === 'IMPORTED' ? 'reviewed' : 'neutral'}>{STATUS_LABELS[entry.status]}</Badge>
            <span className="text-muted-foreground">· {count.format(entry.rowCount)} rows · uploaded {when(entry.createdAt)}</span>
          </span>
          {entry.withdrawal ? (
            <span className="text-muted-foreground">
              Deleted {when(entry.withdrawal.withdrawnAt)}
              {entry.withdrawal.withdrawnByName ? ` by ${entry.withdrawal.withdrawnByName}` : ''}: “{entry.withdrawal.reason}” · {count.format(entry.voidedRecords)} records voided
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
