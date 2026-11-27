import type { Page } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from '@pactlab/ui';
import { ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { keepParams, pageApiQuery, Pager, pagerLinks, readPage } from '../../../../../_components/pager';
import { apiGet } from '../../../_lib/api';
import { ApiState } from '../../../_lib/states';
import { activityHref, peoplePageHref } from '../view';
import { formatMonth } from '@pactlab/domain';

export const dynamic = 'force-dynamic';

interface IssueRow {
  key: string;
  type: string | null;
  providerType: string | null;
  priority: string | null;
  statusCategory: string | null;
  createdAt: string | null;
  resolvedAt: string | null;
  reopenCount: number;
  url: string | null;
  code: { kind: 'COMMIT' | 'PULL_REQUEST'; id: string; url: string | null }[];
}
interface PullRow {
  number: number;
  title: string | null;
  state: string | null;
  createdAt: string | null;
  mergedAt: string | null;
  author: string | null;
  approvals: number | null;
  changesRequested: number | null;
  checksTotal: number | null;
  checksFailed: number | null;
  url: string | null;
  issues: string[];
}
interface ActivityView {
  kind: 'code' | 'delivery';
  month: string;
  health: { commits: number; codeContributors: number; issuesResolved: number; pointsResolved: number } | null;
  page: Page<IssueRow | PullRow>;
  committers: { contributorKey: string; label: string; commits: number; areas: string[] }[] | null;
  committerCount: number;
  suppressed: boolean;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const monthLabel = (value: string) => formatMonth(value, { style: 'long' });
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '—');
const STATUS: Record<string, string> = { TO_DO: 'To do', IN_PROGRESS: 'In progress', DONE: 'Done' };
const shift = (value: string, months: number) => {
  const date = new Date(`${value}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 7);
};
const Out = ({ href, children }: { href: string | null; children: React.ReactNode }) =>
  href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-indigo-ink hover:underline">
      {children} <ExternalLink aria-hidden className="h-3 w-3" />
    </a>
  ) : (
    <span className="font-medium">{children}</span>
  );

/**
 * Behind a point on the Engineering charts (T-129): a month's pull requests and who committed, or
 * its resolved Jira issues, each linked to the code that cites it. From synced evidence; links go
 * out only to real systems (a live connection, or the recorded apache/kafka data).
 */
export default async function EngineeringActivityPage({ params, searchParams }: { params: Promise<{ dealId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { dealId } = await params;
  const search = await searchParams;
  const kind = search['kind'] === 'delivery' ? 'delivery' : 'code';
  const month = typeof search['month'] === 'string' && MONTH.test(search['month']) ? search['month'] : new Date().toISOString().slice(0, 7);
  const type = typeof search['type'] === 'string' && ['Story', 'Bug', 'Task'].includes(search['type']) ? search['type'] : undefined;
  const status = typeof search['status'] === 'string' && Object.hasOwn(STATUS, search['status']) ? search['status'] : undefined;
  const position = readPage(search);
  const query = new URLSearchParams({ kind, month, ...(type ? { type } : {}), ...(status ? { status } : {}) });
  const result = await apiGet<ActivityView>(`/v1/deals/${dealId}/engineering/activity?${query.toString()}&${pageApiQuery(position)}`);
  if (result.kind !== 'ok') return <ApiState result={result} />;
  const view = result.data;
  const base = `/deals/${dealId}/engineering/activity`;
  const items = view.page.items;

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link href={`/deals/${dealId}/engineering`} className="text-sm text-muted-foreground hover:underline">
          ← Engineering
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-auto text-lg font-semibold tracking-tight">
            {kind === 'delivery' ? 'Jira issues resolved' : 'Code activity'} · {monthLabel(month)}
          </h2>
          <nav aria-label="Months" className="flex gap-3 text-sm">
            <Link href={activityHref(dealId, kind, shift(month, -1), { type, status })} className="font-semibold text-indigo-ink hover:underline">
              ← {monthLabel(shift(month, -1))}
            </Link>
            <Link href={activityHref(dealId, kind, shift(month, 1), { type, status })} className="font-semibold text-indigo-ink hover:underline">
              {monthLabel(shift(month, 1))} →
            </Link>
          </nav>
        </div>
        <nav aria-label="Code or delivery" className="inline-flex w-fit rounded-lg border border-navy/10 bg-mist p-1 text-sm font-semibold">
          {(['code', 'delivery'] as const).map((entry) => (
            <Link key={entry} href={activityHref(dealId, entry, month)} aria-current={entry === kind ? 'page' : undefined} className={`rounded-md px-3 py-1 ${entry === kind ? 'bg-white shadow-sm' : 'text-slate-text'}`}>
              {entry === 'code' ? 'Pull requests and commits' : 'Jira issues'}
            </Link>
          ))}
        </nav>
        {view.health ? (
          <p className="text-sm text-slate-text">
            {kind === 'code'
              ? `${view.health.commits} commits by ${view.health.codeContributors} people this month.`
              : `${view.health.issuesResolved} issues and ${view.health.pointsResolved} story points resolved this month.`}
          </p>
        ) : null}
      </header>

      {kind === 'code' && view.committers ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Who committed</CardTitle>
            <CardDescription>
              {view.committerCount > view.committers.length ? `The ${view.committers.length} most active of ${view.committerCount} people` : `${view.committerCount} people`}, by commits this month,
              with the areas they worked in. Activity, not performance.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm" aria-label="Committers this month">
              {view.committers.map((person) => (
                <li key={person.contributorKey} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5">
                  <Link href={`/deals/${dealId}/engineering/contributors/${person.contributorKey}`} className="font-bold text-indigo-ink hover:underline">
                    {person.label}
                  </Link>
                  <span>{person.commits} commits</span>
                  <span className="flex flex-wrap gap-1">
                    {person.areas.slice(0, 5).map((area) => (
                      <Link key={area} href={peoplePageHref(dealId, { q: '', tag: null, area, keep: false, page: 1 }, 1)}>
                        <Badge variant="neutral">{area}</Badge>
                      </Link>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : kind === 'code' && view.suppressed ? (
        <p className="text-sm text-slate-text">Fewer than 5 people contribute, so who committed is not shown — it would identify people.</p>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-end gap-3">
          <div className="mr-auto flex flex-col gap-1">
            <CardTitle className="text-base">{kind === 'delivery' ? 'Issues' : 'Pull requests opened or merged'}</CardTitle>
            <CardDescription>
              {kind === 'delivery' ? 'Each issue with the commits and pull requests that name it.' : 'Each pull request with its reviews, CI and the issues it names.'}
            </CardDescription>
          </div>
          {kind === 'delivery' ? (
            <form method="get" className="flex flex-wrap items-end gap-2 text-sm" aria-label="Filter issues">
              <input type="hidden" name="kind" value="delivery" />
              <input type="hidden" name="month" value={month} />
              <label className="flex flex-col gap-1 font-medium">
                Type
                <select name="type" defaultValue={type ?? ''} className="rounded-md border border-border bg-background px-2 py-1.5">
                  <option value="">All</option>
                  <option value="Story">Story</option>
                  <option value="Bug">Bug</option>
                  <option value="Task">Task</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 font-medium">
                Status
                <select name="status" defaultValue={status ?? ''} className="rounded-md border border-border bg-background px-2 py-1.5">
                  <option value="">All</option>
                  {Object.entries(STATUS).map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" size="sm" variant="outline">
                Filter
              </Button>
            </form>
          ) : null}
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {items.length === 0 ? (
            <div className="p-6">
              <EmptyState title="Nothing this month" description={kind === 'delivery' ? 'No issues were resolved in this month (with these filters).' : 'No pull requests were opened or merged this month.'} />
            </div>
          ) : kind === 'delivery' ? (
            <table className="w-full text-left text-sm" aria-label="Issues resolved this month">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Issue</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Priority</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Created</th>
                  <th className="px-4 py-2">Resolved</th>
                  <th className="px-4 py-2">Reopened</th>
                  <th className="px-4 py-2">Code</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(items as IssueRow[]).map((issue) => (
                  <tr key={issue.key}>
                    <td className="px-4 py-2 font-mono">
                      <Out href={issue.url}>{issue.key}</Out>
                    </td>
                    <td className="px-4 py-2">{issue.providerType ?? issue.type ?? '—'}</td>
                    <td className="px-4 py-2">{issue.priority ?? '—'}</td>
                    <td className="px-4 py-2">{issue.statusCategory ? (STATUS[issue.statusCategory] ?? issue.statusCategory) : '—'}</td>
                    <td className="px-4 py-2 text-xs">{day(issue.createdAt)}</td>
                    <td className="px-4 py-2 text-xs">{day(issue.resolvedAt)}</td>
                    <td className="px-4 py-2">{issue.reopenCount > 0 ? <Badge variant="danger">{issue.reopenCount}×</Badge> : '—'}</td>
                    <td className="px-4 py-2 text-xs">
                      {issue.code.length === 0 ? (
                        <span className="text-muted-foreground">None linked</span>
                      ) : (
                        <span className="flex flex-wrap gap-x-2">
                          {issue.code.slice(0, 6).map((link) => (
                            <Out key={`${link.kind}${link.id}`} href={link.url}>
                              {link.kind === 'COMMIT' ? link.id.slice(0, 7) : `PR #${link.id}`}
                            </Out>
                          ))}
                          {issue.code.length > 6 ? <span>+{issue.code.length - 6} more</span> : null}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left text-sm" aria-label="Pull requests this month">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Pull request</th>
                  <th className="px-4 py-2">State</th>
                  <th className="px-4 py-2">Author</th>
                  <th className="px-4 py-2">Reviews</th>
                  <th className="px-4 py-2">CI</th>
                  <th className="px-4 py-2">Opened</th>
                  <th className="px-4 py-2">Merged</th>
                  <th className="px-4 py-2">Issues</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(items as PullRow[]).map((pull) => (
                  <tr key={pull.number}>
                    <td className="max-w-md px-4 py-2">
                      <Out href={pull.url}>#{pull.number}</Out> <span className="text-slate-text">{pull.title ?? ''}</span>
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={pull.state === 'MERGED' ? 'reviewed' : 'neutral'}>{pull.state ?? '—'}</Badge>
                    </td>
                    <td className="px-4 py-2 text-xs">{pull.author ?? '—'}</td>
                    <td className="px-4 py-2 text-xs">
                      {pull.approvals === null ? '—' : `${pull.approvals} approved${pull.changesRequested ? `, ${pull.changesRequested} changes asked` : ''}`}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {pull.checksTotal === null || pull.checksTotal === 0 ? '—' : pull.checksFailed ? <Badge variant="danger">{pull.checksFailed} of {pull.checksTotal} failed</Badge> : `${pull.checksTotal} passed`}
                    </td>
                    <td className="px-4 py-2 text-xs">{day(pull.createdAt)}</td>
                    <td className="px-4 py-2 text-xs">{day(pull.mergedAt)}</td>
                    <td className="px-4 py-2 text-xs">
                      {pull.issues.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="flex flex-wrap gap-x-2 font-mono">
                          {pull.issues.map((key) => (
                            <span key={key}>{key}</span>
                          ))}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Pager label={kind === 'delivery' ? 'Issue pages' : 'Pull request pages'} base={base} links={pagerLinks({ ...view.page, itemCount: items.length }, position, keepParams(search))} />
        </CardContent>
      </Card>
    </div>
  );
}
