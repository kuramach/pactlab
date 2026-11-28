import type { MyFeatureRequestView, Page } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, EmptyState, PageHeader } from '@pactlab/ui';
import { getI18n } from '../../../../lib/i18n/server';
import { keepParams, pageApiQuery, Pager, pagerLinks, readPage } from '../../../_components/pager';
import { apiGet } from '../../deals/_lib/api';
import { ApiState } from '../../deals/_lib/states';
import { answerFeatureQuestion } from './actions';

export const dynamic = 'force-dynamic';

const BADGE: Record<MyFeatureRequestView['status'], 'draft' | 'reviewed' | 'neutral'> = { SUBMITTED: 'draft', IN_TRIAGE: 'draft', INFO_REQUESTED: 'draft', APPROVED: 'reviewed', DECLINED: 'neutral', SHIPPED: 'reviewed' };

/** The feature requests you made in the help chat, and where each stands (T-176). Only yours. */
export default async function FeatureRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const { m } = await getI18n();
  const t = m.features.mine;
  const position = readPage(search);
  const result = await apiGet<Page<MyFeatureRequestView>>(`/v1/feature-requests/mine?${pageApiQuery(position)}`);
  const crumbs = [{ href: '/', label: m.pact.breadcrumbs.home }, { href: '/settings', label: t.settings }, { label: t.title }];
  const header = <PageHeader breadcrumbs={crumbs} title={t.title} description={t.description} />;
  if (result.kind !== 'ok') return <div className="flex max-w-4xl flex-col gap-4">{header}<ApiState result={result} /></div>;
  const outcomes: Record<string, string> = t.outcomes;
  const outcome = typeof search['outcome'] === 'string' ? outcomes[search['outcome']] : undefined;
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      {header}
      {outcome ? <p role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">{outcome}</p> : null}
      {result.data.items.length === 0 ? (
        <EmptyState title={t.emptyTitle} description={t.emptyDescription} />
      ) : (
        <Card section="bugs">
          <CardContent className="p-0">
            <ul className="divide-y divide-border" aria-label={t.list}>
              {result.data.items.map((request) => {
                const status = m.features.status[request.status];
                return (
                  <li key={request.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{request.reference}</span>
                      <span className="font-medium">{request.title}</span>
                      <Badge variant={BADGE[request.status]}>{status.label}</Badge>
                    </div>
                    <p className="text-muted-foreground">{status.text}</p>
                    {request.declineReason ? <p><strong>{t.reason}</strong> {request.declineReason}</p> : null}
                    {request.whatsNewUrl ? <p><a href={request.whatsNewUrl} className="text-indigo-ink underline">{t.whatsNew}</a></p> : null}
                    {request.question ? (
                      <form action={answerFeatureQuestion.bind(null, request.proposalId)} className="mt-1 flex flex-col gap-2">
                        <label className="flex flex-col gap-1 font-medium">
                          {t.asks} {request.question}
                          <textarea name="reply" required maxLength={2000} rows={3} className="rounded-md border border-border bg-background px-2 py-1.5 font-normal" />
                        </label>
                        <div><Button size="sm" type="submit">{t.sendAnswer}</Button></div>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <Pager label={t.pages} base="/settings/feature-requests" links={pagerLinks({ ...result.data, itemCount: result.data.items.length }, position, keepParams(search))} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
