import type { Page } from '@pactlab/contracts';
import { Badge, Button, Card, EmptyState, PageHeader } from '@pactlab/ui';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { keepParams, Pager, pagerLinks, pageApiQuery, readPage } from '../../_components/pager';
import { apiGet } from '../deals/_lib/api';
import { ApiState } from '../deals/_lib/states';
import { markAllNotificationsRead, markNotificationRead, openNotification } from './actions';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

interface NotificationItem {
  id: string;
  urgency: 'ACT_NOW' | 'FYI';
  title: string;
  dealName: string;
  link: string;
  createdAt: string;
  readAt: string | null;
  emailStatus: string;
}

/** What happened to the email for an item, in plain words; nothing while it is still on its way. */
const EMAIL_NOTES: Record<string, string> = {
  SENT: 'Emailed',
  SUPPRESSED: 'Not emailed: your address bounced or reported spam; ask your administrator',
  FAILED: 'The email could not be delivered',
  NO_ADDRESS: 'Not emailed: no email address on your sign-in',
};
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

/**
 * The inbox behind the bell (T-145): what changed on your pacts, newest first. Each item opens the
 * exact place in the pact; only what you may already see there is listed.
 */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const unreadOnly = params['unread'] === 'true';
  const position = readPage(params);
  const query = new URLSearchParams(pageApiQuery(position));
  if (unreadOnly) query.set('unread', 'true');
  const result = await apiGet<Page<NotificationItem>>(`/v1/notifications?${query}`);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        tone="navy"
        breadcrumbs={[{ href: '/', label: 'Home' }, { label: 'Notifications' }]}
        title="Notifications"
        description="What changed on your pacts. Act-now items are emailed at once; the rest go in your digest. Choose how in Settings → Notifications."
        actions={
          <form action={markAllNotificationsRead}>
            <Button type="submit" variant="outline" size="sm">
              Mark all read
            </Button>
          </form>
        }
      />
      <nav aria-label="Show" className="flex gap-4 text-sm">
        <Link href="/notifications" aria-current={unreadOnly ? undefined : 'page'} className={unreadOnly ? 'hover:underline' : 'font-semibold'}>
          All
        </Link>
        <Link href="/notifications?unread=true" aria-current={unreadOnly ? 'page' : undefined} className={unreadOnly ? 'font-semibold' : 'hover:underline'}>
          Unread
        </Link>
        <Link href="/settings/notifications" className="ml-auto text-indigo-ink hover:underline">
          Notification settings
        </Link>
      </nav>
      {result.kind !== 'ok' ? (
        <ApiState result={result} />
      ) : result.data.items.length === 0 ? (
        <EmptyState icon={<Bell aria-hidden className="h-6 w-6" />} title={unreadOnly ? 'Nothing unread' : 'Nothing yet'} description="When something changes on one of your pacts, it appears here." />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border" aria-label="Notifications">
            {result.data.items.map((item) => (
              <li key={item.id} className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm ${item.readAt ? '' : 'bg-muted/40'}`}>
                <div className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    {item.readAt ? null : <span className="sr-only">Unread:</span>}
                    <span className={item.readAt ? '' : 'font-semibold'}>{item.title}</span>
                    {item.urgency === 'ACT_NOW' ? <Badge>Act now</Badge> : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {item.dealName} · {when(item.createdAt)}
                    {EMAIL_NOTES[item.emailStatus] ? ` · ${EMAIL_NOTES[item.emailStatus]}` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {item.readAt ? null : (
                    <form action={markNotificationRead.bind(null, item.id)}>
                      <Button type="submit" variant="ghost" size="sm" aria-label={`Mark “${item.title}” on ${item.dealName} read`}>
                        Mark read
                      </Button>
                    </form>
                  )}
                  <form action={openNotification.bind(null, item.id, item.link)}>
                    <Button type="submit" size="sm" aria-label={`Open “${item.title}” on ${item.dealName}`}>
                      Open
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
          <Pager label="Notification pages" base="/notifications" links={pagerLinks({ ...result.data, itemCount: result.data.items.length }, position, keepParams(params))} />
        </Card>
      )}
    </div>
  );
}
