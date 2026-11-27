import type { SourceWithdrawnFlag } from '@pactlab/domain';
import { Badge } from '@pactlab/ui';
import Link from 'next/link';
import { formatDate } from '@pactlab/domain';

const when = { format: (value: Date | string) => formatDate(value, { locale: 'en-GB' }) };

/** The short "source withdrawn" mark beside an artefact built on a withdrawn import (T-154). */
export function SourceWithdrawnBadge({ flags }: { flags: readonly SourceWithdrawnFlag[] | undefined }) {
  if (!flags || flags.length === 0) return null;
  return (
    <Badge variant="danger" title={flags.map((flag) => `${flag.fileName}: ${flag.reason}`).join('\n')}>
      Source withdrawn
    </Badge>
  );
}

/**
 * Why an artefact is flagged: which import it rested on, when and why that import was withdrawn.
 * The artefact itself is unchanged; re-running on current data produces a fresh one.
 */
export function SourceWithdrawnNotice({ dealId, flags, subject }: { dealId: string; flags: readonly SourceWithdrawnFlag[] | undefined; subject: string }) {
  if (!flags || flags.length === 0) return null;
  return (
    <div role="status" className="flex flex-col gap-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
      <p className="font-medium">Source withdrawn: {subject} was built on data from an import that has since been withdrawn. It is kept as it was.</p>
      <ul className="list-disc pl-5">
        {flags.map((flag) => (
          <li key={flag.uploadId}>
            <Link href={`/deals/${dealId}/sources/upload/${flag.uploadId}`} className="underline">
              {flag.fileName}
            </Link>{' '}
            withdrawn {when.format(new Date(flag.withdrawnAt))}: “{flag.reason}”
          </li>
        ))}
      </ul>
    </div>
  );
}
