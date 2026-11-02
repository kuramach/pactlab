import type { MyBugReportView } from '@pactlab/contracts';
import { Badge, Card, CardContent, EmptyState, PageHeader } from '@pactlab/ui';
import { ChevronRight, MessageSquareReply } from 'lucide-react';
import Link from 'next/link';
import { apiGet } from '../../deals/_lib/api';
import { ApiState } from '../../deals/_lib/states';
import { day, isOpen, pagePath, SEVERITY_LABELS, STATUS_LABELS, statusBadge } from './_lib/status';

export const dynamic = 'force-dynamic';

const TABS = [
  ['all', 'All'],
  ['open', 'Open'],
  ['closed', 'Closed'],
] as const;

/** The reports you filed, where each one stands, and Pactlab's replies (T-072). */
export default async function BugsSubmittedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const show = (await searchParams)['show'];
  const tab = show === 'open' || show === 'closed' ? show : 'all';
  const result = await apiGet<{ items: MyBugReportView[] }>('/v1/bug-reports/mine');
  const crumbs = [{ href: '/', label: 'Home' }, { href: '/settings', label: 'Settings' }, { label: 'Bugs submitted' }];
  const header = <PageHeader breadcrumbs={crumbs} title="Bugs submitted" description="Problems you reported with the bug button (bottom right of every page), where each one stands, and our replies." />;
  if (result.kind !== 'ok') return <div className="flex max-w-4xl flex-col gap-4">{header}<ApiState result={result} /></div>;

  const all = result.data.items;
  const open = all.filter((bug) => isOpen(bug.status));
  const items = tab === 'open' ? open : tab === 'closed' ? all.filter((bug) => !isOpen(bug.status)) : all;
  const counts: Record<string, number> = { all: all.length, open: open.length, closed: all.length - open.length };
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      {header}
      {all.length === 0 ? (
        <EmptyState title="No reports yet" description="Use the bug button at the bottom right of any page to tell us about a problem. It attaches the page and, if you like, a screenshot." />
      ) : (
        <>
          <nav aria-label="Filter reports" className="flex gap-1 text-sm">
            {TABS.map(([key, label]) => (
              <Link key={key} href={key === 'all' ? '/settings/bug-reports' : `/settings/bug-reports?show=${key}`} aria-current={tab === key ? 'page' : undefined} className={`rounded-full px-3 py-1 ${tab === key ? 'bg-navy text-white' : 'text-muted-foreground hover:bg-muted'}`}>
                {label} ({counts[key]})
              </Link>
            ))}
          </nav>
          <Card>
            <CardContent className="p-0">
              {items.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Nothing here.</p>
              ) : (
                <ul className="divide-y divide-border" aria-label="Bugs submitted">
                  {items.map((bug) => (
                    <li key={bug.id}>
                      <Link href={`/settings/bug-reports/${bug.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/60">
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs text-muted-foreground">{bug.reference}</span>
                            <span className="truncate font-medium">{bug.title}</span>
                            <Badge variant={statusBadge(bug.status)}>{STATUS_LABELS[bug.status] ?? bug.status}</Badge>
                            {bug.hasReply ? (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-ink">
                                <MessageSquareReply aria-hidden className="h-3.5 w-3.5" /> Replied
                              </span>
                            ) : null}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {SEVERITY_LABELS[bug.severity] ?? bug.severity} severity
                            {pagePath(bug.page) ? <> · on <span className="font-mono">{pagePath(bug.page)}</span></> : null}
                            {' · '}filed {day(bug.filedAt)}
                            {bug.updatedAt > bug.filedAt ? ` · updated ${day(bug.updatedAt)}` : ''}
                            {bug.occurrences > 1 ? ` · happened ${bug.occurrences} times` : ''}
                          </p>
                        </div>
                        <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
