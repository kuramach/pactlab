import type { FeatureRequestDetailView, FeatureRequestSupporterView, Page } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@pactlab/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGet } from '../../../(app)/deals/_lib/api';
import { getI18n } from '../../../../lib/i18n/server';
import { approveFeatureRequest, decideFeatureRequest, groupFeatureSupporter, linkFeatureRequest } from '../../feature-actions';

export const dynamic = 'force-dynamic';

const field = 'rounded-md border border-border bg-background px-2 py-1.5 text-sm';
const label = 'flex flex-col gap-1 text-sm font-medium';

export default async function FeatureRequestPage({ params, searchParams }: { params: Promise<{ requestId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { requestId } = await params;
  const outcome = (await searchParams)['outcome'];
  const { m, fill } = await getI18n();
  const t = m.features.admin;
  const [detail, supporters] = await Promise.all([
    apiGet<FeatureRequestDetailView>(`/v1/admin/feature-requests/${encodeURIComponent(requestId)}`),
    apiGet<Page<FeatureRequestSupporterView>>(`/v1/admin/feature-requests/${encodeURIComponent(requestId)}/supporters?limit=100`),
  ]);
  if (detail.kind !== 'ok') notFound();
  const view = detail.data;
  const open = view.status !== 'APPROVED' && view.status !== 'SHIPPED';
  const spec = view.taskSpec ?? view.proposedTask;
  const outcomes: Record<string, string> = t.outcomes;
  const message = typeof outcome === 'string' ? outcomes[outcome] : undefined;
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;
  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin?tab=features" className="text-sm text-muted-foreground hover:underline">{t.back}</Link>
      <h1 className="text-xl font-bold"><span className="font-mono">{view.reference}</span> {view.title}</h1>
      {message ? <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{message}</p> : null}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="draft">{m.features.status[view.status].label}</Badge>
        <span className="text-muted-foreground">
          {view.surface === 'SITE' ? t.publicSite : t.inApp} · {view.page} · {view.locale} · {t.supporters.toLowerCase()} {view.supporters}
          {view.suggested > 0 ? ` ${fill(t.suggested, { count: view.suggested })}` : ''}
        </span>
      </div>

      {view.earlier ? (
        <p role="note" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          {t.earlier} <Link href={`/admin/feature-requests/${view.earlier.id}`} className="underline">{view.earlier.title}</Link> {t.earlierWas} {m.features.status[view.earlier.status].label.toLowerCase()}
          {view.earlier.reason ? ` — “${view.earlier.reason}”` : ''}
        </p>
      ) : null}

      <Card>
        <CardHeader><CardTitle className="text-base">{t.wordsTitle}</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p>{view.description}</p>
          {view.infoQuestion ? <p><strong>{t.youAsked}</strong> {view.infoQuestion}</p> : null}
          {view.infoReply ? <p><strong>{t.theyAnswered}</strong> {view.infoReply}</p> : null}
          {view.declineReason ? <p><strong>{t.declinedBecause}</strong> {view.declineReason}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t.requesters}</CardTitle></CardHeader>
        <CardContent>
          {supporters.kind !== 'ok' ? <p className="text-sm text-muted-foreground">{t.requestersFailed}</p> : (
            <ul className="divide-y divide-border text-sm" aria-label={t.requesters}>
              {supporters.data.items.map((item) => (
                <li key={item.id} className="flex flex-col gap-1 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={item.grouping === 'SUGGESTED' ? 'neutral' : 'reviewed'}>{item.grouping.toLowerCase()}</Badge>
                    <span>{item.email ?? item.organizationName ?? t.signedInUser}</span>
                    <span className="text-xs text-muted-foreground">{item.surface === 'SITE' ? t.site : t.app} · {item.page} · {item.createdAt.slice(0, 10)}</span>
                  </div>
                  <p className="text-muted-foreground">“{item.description}”</p>
                  {item.grouping === 'SUGGESTED' ? (
                    <div className="flex gap-2">
                      <form action={groupFeatureSupporter.bind(null, view.id, item.id)}>{hidden('confirm', 'yes')}<Button size="sm" type="submit">{t.sameAsk}</Button></form>
                      <form action={groupFeatureSupporter.bind(null, view.id, item.id)}>{hidden('confirm', 'no')}<Button size="sm" variant="outline" type="submit">{t.different}</Button></form>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {open ? (
        <Card>
          <CardHeader><CardTitle className="text-base">{t.triage}</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {view.status === 'SUBMITTED' ? <form action={decideFeatureRequest.bind(null, view.id)}>{hidden('action', 'TRIAGE')}<Button size="sm" variant="outline" type="submit">{t.takeUp}</Button></form> : null}
              {view.status === 'INFO_REQUESTED' ? (
                <form action={decideFeatureRequest.bind(null, view.id)} className="flex flex-wrap items-end gap-2">
                  {hidden('action', 'REOPEN')}
                  <label className={label}>{t.theirReply}<input name="reply" maxLength={2000} className={field} /></label>
                  <Button size="sm" variant="outline" type="submit">{t.reopen}</Button>
                </form>
              ) : null}
            </div>
            <form action={decideFeatureRequest.bind(null, view.id)} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end" aria-label={t.requestInfoForm}>
              {hidden('action', 'REQUEST_INFO')}
              <label className={label}>{t.questionLabel}<input name="question" required minLength={3} maxLength={1000} className={field} /></label>
              <Button size="sm" variant="outline" type="submit">{t.requestInfo}</Button>
            </form>
            <form action={decideFeatureRequest.bind(null, view.id)} className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end" aria-label={t.declineForm}>
              {hidden('action', 'DECLINE')}
              <label className={label}>{t.reasonLabel}<input name="reason" maxLength={500} className={field} /></label>
              <Button size="sm" variant="outline" type="submit">{view.status === 'DECLINED' ? t.updateDecline : t.reject}</Button>
            </form>
            <form action={approveFeatureRequest.bind(null, view.id)} className="grid gap-3 text-sm sm:grid-cols-2" aria-label={t.approveForm}>
              <h2 className="font-semibold sm:col-span-2">{t.approveTitle}</h2>
              <p className="text-xs text-muted-foreground sm:col-span-2">{t.approveNote}</p>
              <label className={`${label} sm:col-span-2`}>{t.taskTitle}<input name="title" required defaultValue={spec.title} maxLength={100} className={field} /></label>
              <label className={label}>{t.model}<select name="model" defaultValue={spec.model} className={field}>{['sonnet', 'opus'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
              <label className={label}>{t.context}<select name="context" defaultValue={spec.context} className={field}>{['light', 'standard', 'deep'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
              <label className={label}>{t.lane}<input name="lane" required defaultValue={spec.lane} className={field} /></label>
              <label className={label}>{t.needs}<input name="needs" defaultValue={spec.needs} className={field} /></label>
              <label className={`${label} sm:col-span-2`}>{t.touches}<input name="touches" required defaultValue={spec.touches.join(' ')} className={`${field} font-mono`} /></label>
              <div className="sm:col-span-2"><Button size="sm" type="submit">{t.approve}</Button></div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {view.status === 'APPROVED' || view.status === 'SHIPPED' ? (
        <Card>
          <CardHeader><CardTitle className="text-base">{t.task}</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {view.taskId ? <p><span className="font-mono">{view.taskId}</span>{view.pullRequestUrl ? <> · <a href={view.pullRequestUrl} className="underline" target="_blank" rel="noopener noreferrer">{t.pullRequest}</a></> : null}</p> : null}
            {view.taskIssueUrl && !view.taskId ? (
              <p>
                <a href={view.taskIssueUrl} className="underline" target="_blank" rel="noopener noreferrer">{t.openIssue}</a>
                {fill(t.thenLabel, { reference: view.reference })}
              </p>
            ) : null}
            {!view.taskIssueUrl && !view.taskId ? <p className="text-muted-foreground">{t.noRepository}</p> : null}
            <form action={linkFeatureRequest.bind(null, view.id)} className="grid gap-2 sm:grid-cols-3 sm:items-end" aria-label={t.linkForm}>
              <label className={label}>{t.taskId}<input name="taskId" defaultValue={view.taskId ?? ''} pattern="T-[0-9]{3,5}[a-z]?" className={`${field} font-mono`} /></label>
              <label className={label}>{t.pullRequestField}<input name="pullRequestUrl" defaultValue={view.pullRequestUrl ?? ''} className={field} /></label>
              <label className={label}>{t.whatsNewField}<input name="whatsNewUrl" defaultValue={view.whatsNewUrl ?? ''} className={field} /></label>
              <div className="sm:col-span-3"><Button size="sm" variant="outline" type="submit">{t.saveLinks}</Button></div>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
