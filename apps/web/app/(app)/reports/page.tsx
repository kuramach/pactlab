import type { DealSummary, ReportVersionView } from '@pactlab/contracts';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, PageHeader } from '@pactlab/ui';
import { Download, FileText } from 'lucide-react';
import { AutoRefresh } from '../deals/[dealId]/foresight/auto-refresh';
import { apiGet } from '../deals/_lib/api';
import { ApiState } from '../deals/_lib/states';
import { OutcomeBanner } from '../deals/_lib/outcome';
import { generatePactReport, generateReport } from './actions';

export const dynamic = 'force-dynamic';

const OUTCOMES: Record<string, string> = {
  'ok-generating': 'Generating your report. It appears below as Ready in a few seconds.',
  failed: 'The report could not be started. Try again in a moment.',
  'pick-pact': 'Choose a pact for the detailed report.',
};
const STATUS: Record<ReportVersionView['status'], { label: string; variant: 'calculation' | 'draft' | 'danger' | 'neutral' }> = {
  GENERATING: { label: 'Generating', variant: 'draft' },
  READY: { label: 'Ready', variant: 'calculation' },
  FAILED: { label: 'Failed', variant: 'danger' },
  PURGED: { label: 'Removed with its pact', variant: 'neutral' },
};
const at = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

/**
 * Reports (T-110): an executive report across your pacts, or the complete record of one pact,
 * as PDF. Every generation is a new version; earlier versions never change.
 */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = await searchParams;
  const dealId = typeof search['dealId'] === 'string' ? search['dealId'] : '';
  const [history, deals] = await Promise.all([apiGet<{ items: ReportVersionView[] }>('/v1/reports'), apiGet<{ items: DealSummary[] }>('/v1/deals')]);
  if (history.kind !== 'ok') return <ApiState result={history} />;
  const items = history.data.items;
  const pacts = deals.kind === 'ok' ? deals.data.items : [];
  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <PageHeader title="Reports" description="Where every pact stands, or the complete record of one, as a PDF you can forward. Each report is a dated version; earlier versions never change." />
      <OutcomeBanner outcome={typeof search['outcome'] === 'string' ? search['outcome'] : undefined} messages={OUTCOMES} />
      {items.some((item) => item.status === 'GENERATING') ? <AutoRefresh /> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Executive report</CardTitle>
            <CardDescription>All your pacts on a page: phase, asking and priced value, open risks and what needs you next, with the totals they add up to.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={generateReport.bind(null, 'EXECUTIVE', null)}>
              <Button type="submit">
                <FileText aria-hidden className="h-4 w-4" /> Generate executive report
              </Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pact report</CardTitle>
            <CardDescription>The full record of one pact: evidence, findings, claims, valuation, terms and post-close — exactly what your side can see.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={generatePactReport} className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-sm font-medium">
                Pact
                <select name="dealId" defaultValue={dealId} required className="min-w-56 rounded-md border border-border bg-background px-3 py-2 text-sm">
                  <option value="" disabled>
                    Choose a pact
                  </option>
                  {pacts.map((pact) => (
                    <option key={pact.id} value={pact.id}>
                      {pact.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" variant="outline">
                Generate pact report
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
          <CardDescription>Every version, newest first, with when its data was taken.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {items.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No reports yet" description="Generate an executive report or a pact report above." />
            </div>
          ) : (
            <table className="w-full text-left text-sm" aria-label="Report history">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Report</th>
                  <th className="px-4 py-2">Version</th>
                  <th className="px-4 py-2">Data as of</th>
                  <th className="px-4 py-2">Generated by</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-2 font-medium">{item.scope === 'EXECUTIVE' ? 'Executive report' : `Pact report: ${item.dealName ?? 'a pact'}`}</td>
                    <td className="px-4 py-2 font-mono">v{item.version}</td>
                    <td className="px-4 py-2 text-xs">{at(item.dataAsOf)}</td>
                    <td className="px-4 py-2 text-xs">{item.generatedByName ?? '—'}</td>
                    <td className="px-4 py-2">
                      <Badge variant={STATUS[item.status].variant}>{STATUS[item.status].label}</Badge>
                    </td>
                    <td className="px-4 py-2">
                      {item.status === 'READY' ? (
                        <a href={`/reports/${item.id}/pdf`} className="inline-flex items-center gap-1 text-sm font-medium text-indigo-ink underline" aria-label={`Download ${item.scope === 'EXECUTIVE' ? 'executive report' : 'pact report'} v${item.version}`}>
                          <Download aria-hidden className="h-4 w-4" /> PDF
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
