import type { BugReportSummaryView } from '@pactlab/contracts';
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@pactlab/ui';
import { apiGet } from '../../deals/_lib/api';
import { ApiState } from '../../deals/_lib/states';

export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<string, string> = { NEW: 'New', TRIAGED: 'Triaged', IN_PROGRESS: 'In progress', RESOLVED: 'Resolved', WONT_FIX: 'Won’t fix' };

/** The reports you filed, with their live status (T-072). */
export default async function MyBugReportsPage() {
  const result = await apiGet<{ items: BugReportSummaryView[] }>('/v1/bug-reports/mine');
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-bold">My bug reports</h1>
      <p className="text-sm text-muted-foreground">Reports you sent with the “Report a bug” button, and where each one stands.</p>
      {result.kind !== 'ok' ? (
        <ApiState result={result} />
      ) : result.data.items.length === 0 ? (
        <EmptyState title="No reports yet" description="Use the bug button at the bottom right of any page to tell us about a problem." />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{result.data.items.length} reports</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm" aria-label="My bug reports">
              {result.data.items.map((bug) => (
                <li key={bug.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="font-mono text-xs">{bug.reference}</span>
                  <span className="font-medium">{bug.title}</span>
                  <Badge variant={bug.status === 'RESOLVED' ? 'calculation' : bug.status === 'WONT_FIX' ? 'neutral' : 'draft'}>{STATUS_LABELS[bug.status] ?? bug.status}</Badge>
                  <span className="ml-auto text-xs text-muted-foreground">{bug.lastSeenAt.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
