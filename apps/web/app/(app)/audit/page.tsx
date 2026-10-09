import { Badge, buttonVariants, Card, EmptyState, PageHeader } from '@pactlab/ui';
import Link from 'next/link';
import { apiGet } from '../deals/_lib/api';
import { ApiState } from '../deals/_lib/states';
import { describeAction } from './_lib/actions';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

interface AuditItem {
  id: string;
  sequence: string;
  occurredAt: string;
  action: string;
  outcome: string;
  targetType: string;
  targetId: string | null;
  dealId: string | null;
  dealName: string | null;
  actorName: string | null;
}

const OUTCOME_VARIANT: Record<string, 'calculation' | 'danger' | 'draft' | 'neutral'> = {
  SUCCEEDED: 'calculation',
  ALLOWED: 'calculation',
  DENIED: 'danger',
  FAILED: 'draft',
};

const when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });

/** The organization's tamper-evident audit trail, newest first. Reading it is itself audited. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const { before } = await searchParams;
  const cursor = before && /^\d{1,18}$/.test(before) ? before : undefined;
  const result = await apiGet<{ items: AuditItem[]; nextBefore: string | null }>(
    `/v1/audit-events?limit=50${cursor ? `&before=${cursor}` : ''}`,
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ href: '/', label: 'Home' }, { label: 'Audit log' }]}
        title="Audit log"
        description="Every sensitive read, change, approval and denial in your organization, in a hash-chained trail. Times are UTC."
      />
      {result.kind === 'forbidden' ? (
        <EmptyState
          title="Administrators only"
          description="Ask an organization owner or administrator for access to the audit log."
          action={
            <Link href="/" className={buttonVariants({ variant: 'outline' })}>
              Back to Home
            </Link>
          }
        />
      ) : result.kind !== 'ok' ? (
        <ApiState result={result} />
      ) : result.data.items.length === 0 ? (
        <EmptyState title="Nothing recorded yet" description="Events appear here as your team works." />
      ) : (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="whitespace-nowrap px-4 py-3 font-medium">When</th>
                  <th scope="col" className="px-4 py-3 font-medium">Who</th>
                  <th scope="col" className="px-4 py-3 font-medium">What</th>
                  <th scope="col" className="px-4 py-3 font-medium">Deal</th>
                  <th scope="col" className="px-4 py-3 font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.data.items.map((item) => (
                  <tr key={item.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground" data-numeric>
                      {when.format(new Date(item.occurredAt))}
                    </td>
                    <td className="px-4 py-3">{item.actorName ?? 'System'}</td>
                    <td className="px-4 py-3">
                      <span className="block">{describeAction(item.action)}</span>
                      <span className="font-mono text-xs text-muted-foreground">{item.action}</span>
                    </td>
                    <td className="px-4 py-3">
                      {item.dealId && item.dealName ? (
                        <Link href={`/deals/${item.dealId}`} className="text-indigo-ink hover:underline">
                          {item.dealName}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Organization</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={OUTCOME_VARIANT[item.outcome] ?? 'neutral'}>{item.outcome.toLowerCase()}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <div className="flex justify-between text-sm">
            {cursor ? (
              <Link href="/audit" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Newest
              </Link>
            ) : (
              <span />
            )}
            {result.data.nextBefore ? (
              <Link href={`/audit?before=${result.data.nextBefore}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                Older
              </Link>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
