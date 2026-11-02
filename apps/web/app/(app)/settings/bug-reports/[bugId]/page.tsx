import type { MyBugReportDetailView } from '@pactlab/contracts';
import { isUuid } from '@pactlab/domain';
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@pactlab/ui';
import { Check, MessageSquareReply } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGet } from '../../../deals/_lib/api';
import { ApiState } from '../../../deals/_lib/states';
import { day, pagePath, SEVERITY_LABELS, STATUS_LABELS, STATUS_MEANING, STATUS_TRACK, statusBadge, TRIGGER_LABELS } from '../_lib/status';

export const dynamic = 'force-dynamic';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2 sm:grid-cols-[10rem_1fr]">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="whitespace-pre-wrap text-sm">{children}</dd>
    </div>
  );
}

/** Where one of your reports stands, Pactlab's reply, and exactly what you sent. */
export default async function BugSubmittedPage({ params }: { params: Promise<{ bugId: string }> }) {
  const { bugId } = await params;
  if (!isUuid(bugId)) notFound();
  const result = await apiGet<MyBugReportDetailView>(`/v1/bug-reports/mine/${encodeURIComponent(bugId)}`);
  if (result.kind === 'not-found') notFound();
  const crumbs = [{ href: '/', label: 'Home' }, { href: '/settings', label: 'Settings' }, { href: '/settings/bug-reports', label: 'Bugs submitted' }, { label: result.kind === 'ok' ? result.data.reference : 'Report' }];
  if (result.kind !== 'ok') return <div className="flex max-w-4xl flex-col gap-4"><PageHeader breadcrumbs={crumbs} title="Bug report" /><ApiState result={result} /></div>;

  const bug = result.data;
  const reached = STATUS_TRACK.indexOf(bug.status as (typeof STATUS_TRACK)[number]);
  const page = pagePath(bug.page);
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader breadcrumbs={crumbs} title={bug.title} description={`${bug.reference} · filed ${day(bug.filedAt)}${bug.updatedAt > bug.filedAt ? ` · last updated ${day(bug.updatedAt)}` : ''}`} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Status <Badge variant={statusBadge(bug.status)}>{STATUS_LABELS[bug.status] ?? bug.status}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm">{STATUS_MEANING[bug.status] ?? ''}</p>
          {bug.status === 'WONT_FIX' ? null : (
            <ol className="grid grid-cols-4 gap-2 text-xs" aria-label="Progress">
              {STATUS_TRACK.map((step, index) => {
                const done = index <= reached;
                return (
                  <li key={step} aria-current={index === reached ? 'step' : undefined} className="flex flex-col gap-1">
                    <span className={`h-1.5 rounded-full ${done ? 'bg-indigo' : 'bg-muted'}`} />
                    <span className={`flex items-center gap-1 ${done ? 'font-semibold' : 'text-muted-foreground'}`}>
                      {done ? <Check aria-hidden className="h-3 w-3" /> : null}
                      {STATUS_LABELS[step]}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquareReply aria-hidden className="h-4 w-4" /> Reply from Pactlab
          </CardTitle>
        </CardHeader>
        <CardContent>
          {bug.reply ? <p className="whitespace-pre-wrap text-sm">{bug.reply}</p> : <p className="text-sm text-muted-foreground">No reply yet. You will see it here, with any change of status.</p>}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What you reported</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-border">
              <Field label="What happened">{bug.whatHappened ?? <span className="text-muted-foreground">—</span>}</Field>
              <Field label="What you expected">{bug.expected ?? <span className="text-muted-foreground">—</span>}</Field>
              <Field label="Page">{page ? <Link href={page} className="font-mono text-indigo-ink underline">{page}</Link> : '—'}</Field>
              {bug.dealId ? <Field label="Pact"><Link href={`/deals/${bug.dealId}`} className="text-indigo-ink underline">Open the pact</Link></Field> : null}
              <Field label="Severity">{SEVERITY_LABELS[bug.severity] ?? bug.severity}</Field>
              <Field label="How it was filed">{TRIGGER_LABELS[bug.trigger] ?? bug.trigger}</Field>
              {bug.occurrences > 1 ? <Field label="Happened">{bug.occurrences} times, last on {day(bug.lastSeenAt)}</Field> : null}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Screenshot</CardTitle>
          </CardHeader>
          <CardContent>
            {bug.hasScreenshot ? (
              <a href={`/settings/bug-reports/${bug.id}/screenshot`} target="_blank" rel="noreferrer">
                <img src={`/settings/bug-reports/${bug.id}/screenshot`} alt={`Screenshot attached to ${bug.reference}`} className="w-full rounded border border-border" />
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">No screenshot attached.</p>
            )}
          </CardContent>
        </Card>
      </div>
      <Link href="/settings/bug-reports" className="text-sm text-muted-foreground hover:underline">← All bugs submitted</Link>
    </div>
  );
}
