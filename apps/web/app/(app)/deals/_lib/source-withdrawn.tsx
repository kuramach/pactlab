import type { SourceWithdrawnFlag } from '@pactlab/domain';
import { Badge } from '@pactlab/ui';
import Link from 'next/link';
import { EN, type I18n } from '../../../../lib/i18n';

/** The short "source withdrawn" mark beside an artefact built on a withdrawn import (T-154). */
export function SourceWithdrawnBadge({ flags, t = EN }: { flags: readonly SourceWithdrawnFlag[] | undefined; t?: I18n }) {
  if (!flags || flags.length === 0) return null;
  return (
    <Badge variant="danger" title={flags.map((flag) => `${flag.fileName}: ${flag.reason}`).join('\n')}>
      {t.m.common.withdrawn.badge}
    </Badge>
  );
}

/**
 * Why an artefact is flagged: which import it rested on, when and why that import was withdrawn.
 * The artefact itself is unchanged; re-running on current data produces a fresh one.
 */
export function SourceWithdrawnNotice({ dealId, flags, subject, t = EN }: { dealId: string; flags: readonly SourceWithdrawnFlag[] | undefined; subject: string; t?: I18n }) {
  if (!flags || flags.length === 0) return null;
  const words = t.m.common.withdrawn;
  return (
    <div role="status" className="flex flex-col gap-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
      <p className="font-medium">{t.fill(words.notice, { subject })}</p>
      <ul className="list-disc pl-5">
        {flags.map((flag) => (
          <li key={flag.uploadId}>
            <Link href={`/deals/${dealId}/sources/upload/${flag.uploadId}`} className="underline">
              {flag.fileName}
            </Link>{' '}
            {t.fill(words.item, { date: t.date(new Date(flag.withdrawnAt)), reason: flag.reason })}
          </li>
        ))}
      </ul>
    </div>
  );
}
