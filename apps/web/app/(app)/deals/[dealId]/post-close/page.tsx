import type { PostCloseItemView, PostCloseView } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from '@pactlab/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGet, dealsApi } from '../../_lib/api';
import { isUuidParam } from '../../_lib/filters';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { refreshPostClose, updatePostCloseItem } from './actions';

export const dynamic = 'force-dynamic';

const inputClass = 'w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

const OUTCOMES: Record<string, string> = {
  'ok-updated': 'Item updated.',
  invalid: 'Check the item’s fields and try again.',
  conflict: 'Someone else changed this item in the meantime — reload and try again.',
  forbidden: 'Your role cannot change post-close items on this deal.',
};

const REGISTERS = [
  { kind: 'ASSET', title: 'Assets to preserve', description: 'What diligence found carries the value — accepted cushions. Review each on its cadence.' },
  { kind: 'WATCH', title: 'Watch items', description: 'Escrow releases and indemnity claim windows from accepted priced risks.' },
  { kind: 'ACTION', title: 'Actions', description: 'Priced remediation, and findings still open at close.' },
] as const;

const STATUS_VARIANT = { OPEN: 'draft', DONE: 'calculation', LAPSED: 'danger' } as const;

function ItemRow({ dealId, item, members, canEdit }: { dealId: string; item: PostCloseItemView; members: PostCloseView['members']; canEdit: boolean }) {
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={STATUS_VARIANT[item.status]}>{item.status.toLowerCase()}</Badge>
        <span className="font-semibold">{item.title}</span>
        <Link href={`/deals/${dealId}/findings/${item.sourceId}`} className="text-xs text-indigo-ink hover:underline">
          source finding →
        </Link>
      </div>
      <p className="text-muted-foreground">{item.action}</p>
      <p className="text-xs text-muted-foreground">
        Owner: {item.ownerName ?? 'not assigned'}
        {item.dueDate ? ` · due ${item.dueDate}` : ''}
        {item.cadence ? ` · reviewed ${item.cadence.toLowerCase()}` : ''}
        {item.note ? ` · “${item.note}”` : ''}
      </p>
      {canEdit ? (
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-indigo-ink">Update</summary>
          <form action={updatePostCloseItem.bind(null, dealId, item.id)} className="mt-2 grid gap-2 sm:grid-cols-5 sm:items-end">
            <input type="hidden" name="expectedVersion" value={item.version} />
            <label className="flex flex-col gap-1 text-xs font-medium">
              Status
              <select name="status" defaultValue={item.status} className={inputClass}>
                <option value="OPEN">Open</option>
                <option value="DONE">Done</option>
                <option value="LAPSED">Lapsed</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">
              Owner
              <select name="ownerUserId" defaultValue={item.ownerUserId ?? ''} className={inputClass}>
                <option value="">—</option>
                {members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">
              Due
              <input type="date" name="dueDate" defaultValue={item.dueDate ?? ''} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">
              Review
              <select name="cadence" defaultValue={item.cadence ?? ''} className={inputClass}>
                <option value="">—</option>
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="ANNUAL">Annually</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium">
              Note
              <input name="note" defaultValue={item.note ?? ''} maxLength={2000} className={inputClass} />
            </label>
            <div>
              <Button type="submit" size="sm">
                Save
              </Button>
            </div>
          </form>
        </details>
      ) : null}
    </li>
  );
}

/** Post-Close: preserve and enhance what was bought. Registers come from diligence, by reference. */
export default async function PostClosePage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  if (!isUuidParam(dealId)) notFound();
  const outcomeParam = (await searchParams)['outcome'];
  const outcome = typeof outcomeParam === 'string' ? outcomeParam : undefined;
  const refreshed = outcome?.match(/^ok-refreshed-(\d+)$/)?.[1];
  const [view, deal] = await Promise.all([apiGet<PostCloseView>(`/v1/deals/${dealId}/post-close`), dealsApi.get(dealId)]);
  if (view.kind !== 'ok') return <ApiState result={view} />;
  const closed = deal.kind === 'ok' && deal.data.phase === 'POST';

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold tracking-tight">Post-close</h2>
        <p className="text-sm text-muted-foreground">
          Preserve and enhance what was bought. These registers are generated from diligence — accepted findings and priced risks — when the pact closes; nothing is re-typed.
        </p>
      </div>
      <OutcomeBanner
        outcome={refreshed !== undefined ? 'ok-refreshed' : outcome}
        messages={{ ...OUTCOMES, 'ok-refreshed': `Registers refreshed from diligence: ${refreshed ?? 0} new item(s).` }}
      />
      {!closed ? (
        <EmptyState title="Not closed yet" description="The post-close registers are generated when the pact moves to Closed." />
      ) : (
        <>
          {view.data.canEdit ? (
            <form action={refreshPostClose.bind(null, dealId)}>
              <Button type="submit" size="sm" variant="outline">
                Refresh from diligence
              </Button>
            </form>
          ) : null}
          {REGISTERS.map((register) => {
            const items = view.data.items.filter((item) => item.kind === register.kind);
            return (
              <Card key={register.kind} aria-labelledby={`register-${register.kind}`}>
                <CardHeader>
                  <CardTitle id={`register-${register.kind}`}>{register.title}</CardTitle>
                  <CardDescription>{register.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  {items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing here from diligence.</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {items.map((item) => (
                        <ItemRow key={item.id} dealId={dealId} item={item} members={view.data.members} canEdit={view.data.canEdit} />
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}
