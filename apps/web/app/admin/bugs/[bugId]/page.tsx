import type { BugReportDetailView } from '@pactlab/contracts';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@pactlab/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGet } from '../../../(app)/deals/_lib/api';
import { CopyButton } from '../../../(app)/_lib/copy-button';
import { serverEnv } from '../../../../lib/env';
import { triageBug } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function BugDetailPage({ params, searchParams }: { params: Promise<{ bugId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { bugId } = await params;
  const outcome = (await searchParams)['outcome'];
  const [bug, task] = await Promise.all([
    apiGet<BugReportDetailView>(`/v1/admin/bugs/${encodeURIComponent(bugId)}`),
    apiGet<{ fileName: string; markdown: string }>(`/v1/admin/bugs/${encodeURIComponent(bugId)}/task?consoleUrl=${encodeURIComponent(serverEnv().APP_BASE_URL)}`),
  ]);
  if (bug.kind !== 'ok') notFound();
  const view = bug.data;
  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin?tab=bugs" className="text-sm text-muted-foreground hover:underline">← Bug inbox</Link>
      <h1 className="text-xl font-bold">
        <span className="font-mono">{view.reference}</span> {view.title}
      </h1>
      {outcome === 'ok-triaged' ? <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">Saved. The reporter sees the new status in My bug reports.</p> : null}
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge>{view.trigger.toLowerCase().replaceAll('_', ' ')}</Badge>
        <Badge variant={view.severity === 'BLOCKER' || view.severity === 'HIGH' ? 'danger' : 'neutral'}>{view.severity.toLowerCase()}</Badge>
        <Badge variant="draft">{view.status.toLowerCase().replace('_', ' ')}</Badge>
        <span className="text-muted-foreground">{view.occurrences}× · first {view.firstSeenAt.slice(0, 10)} · last {view.lastSeenAt.slice(0, 10)} · {view.organizationName}</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Report</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p><strong>What happened:</strong> {view.whatHappened ?? '—'}</p>
            <p><strong>Expected:</strong> {view.expected ?? '—'}</p>
            <p className="text-xs text-muted-foreground">Fingerprint: <span className="font-mono">{view.fingerprint.slice(0, 120)}</span></p>
            <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-2 text-xs" aria-label="Context (scrubbed)">{JSON.stringify(view.context, null, 2)}</pre>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Screenshot</CardTitle></CardHeader>
          <CardContent>
            {view.hasScreenshot ? (
              <img src={`/admin/bugs/${view.id}/screenshot`} alt={`Screenshot attached to ${view.reference}`} className="w-full rounded border border-border" />
            ) : (
              <p className="text-sm text-muted-foreground">No screenshot attached.</p>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Triage</CardTitle></CardHeader>
        <CardContent>
          <form action={triageBug.bind(null, view.id)} className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end text-sm">
            <label className="flex flex-col gap-1 font-medium">Status
              <select name="status" defaultValue={view.status} className="rounded-md border border-border px-2 py-1.5">
                {['NEW', 'TRIAGED', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX'].map((value) => <option key={value} value={value}>{value.toLowerCase().replace('_', ' ')}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 font-medium">Severity
              <select name="severity" defaultValue={view.severity} className="rounded-md border border-border px-2 py-1.5">
                {['BLOCKER', 'HIGH', 'MEDIUM', 'LOW'].map((value) => <option key={value} value={value}>{value.toLowerCase()}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 font-medium">Internal notes (operators only)
              <input name="internalNotes" defaultValue={view.internalNotes ?? ''} maxLength={5000} className="rounded-md border border-border px-2 py-1.5" />
            </label>
            <button className="rounded-md bg-indigo px-3 py-1.5 font-semibold text-navy">Save</button>
          </form>
        </CardContent>
      </Card>
      {task.kind === 'ok' ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">Convert to task</CardTitle>
            <span className="flex gap-2">
              <CopyButton text={task.data.markdown} label="Copy task" />
              <a download={task.data.fileName} href={`data:text/markdown;charset=utf-8,${encodeURIComponent(task.data.markdown)}`} className="rounded-md border border-border px-3 py-1 text-sm">
                Download {task.data.fileName}
              </a>
            </span>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-xs text-muted-foreground">Drop the file into <code>tasks/ready/</code>; the agent loop picks it up. Built from the scrubbed report only.</p>
            <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-2 text-xs">{task.data.markdown}</pre>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
