import { Badge, Button, buttonVariants, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@pactlab/ui';
import Link from 'next/link';
import { apiGet } from '../../_lib/api';
import { OutcomeBanner } from '../../_lib/outcome';
import { ApiState } from '../../_lib/states';
import { can, dealViewer, type DealViewer } from '../../_lib/viewer';
import { decideSubmission, runScenario, submitScenario } from './actions';
import { formatDecimal, formatMoney, formatRatio } from '../../../metrics/_lib/format';
import {
  describeStaleReason,
  freshness,
  isRateVariable,
  isSubtotal,
  parseDealParam,
  SENSITIVITY_LABELS,
  statusVariant,
  type ScenarioView,
  type ValuationResultView,
} from '../../../valuation/_lib/view';

function axisValue(variable: string, value: string): string {
  return isRateVariable(variable) ? formatRatio(value) : formatDecimal(value);
}

function Bridge({ dealId, result }: { dealId: string; result: ValuationResultView }) {
  return (
    <table className="w-full text-sm">
      <tbody className="divide-y divide-border">
        {result.bridge.lines.map((line, index) => (
          <tr key={`${line.kind}-${index}`} className={isSubtotal(line) ? 'font-medium' : ''}>
            <td className="px-4 py-1.5">
              {line.label}
              {line.findingId ? (
                <>
                  {' '}
                  <Link
                    href={`/deals/${dealId}/findings`}
                    className="text-muted-foreground hover:underline"
                  >
                    <Badge variant="reviewed">accepted finding</Badge>
                  </Link>
                </>
              ) : null}
            </td>
            <td className="px-4 py-1.5 text-right font-mono">{formatMoney(line.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Sensitivity({ grid }: { grid: NonNullable<ValuationResultView['sensitivity']> }) {
  return (
    <table className="text-sm">
      <caption className="pb-2 text-left text-muted-foreground">
        Enterprise value — rows: {SENSITIVITY_LABELS[grid.rowVariable] ?? grid.rowVariable};
        columns: {SENSITIVITY_LABELS[grid.columnVariable] ?? grid.columnVariable}
      </caption>
      <thead>
        <tr>
          <th />
          {grid.columns.map((column) => (
            <th key={column} className="px-3 py-1 text-right font-medium">
              {axisValue(grid.columnVariable, column)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {grid.rows.map((row, rowIndex) => (
          <tr key={row}>
            <th className="px-3 py-1 text-left font-medium">{axisValue(grid.rowVariable, row)}</th>
            {grid.columns.map((column, columnIndex) => {
              const cell = grid.cells[rowIndex]?.[columnIndex] ?? null;
              return (
                <td key={column} className="px-3 py-1 text-right font-mono">
                  {cell ? formatDecimal(cell.amount) : 'n/a'}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const OUTCOMES: Record<string, string> = {
  'ok-created': 'Scenario created. Run it to compute value.',
  'ok-saved': 'New assumption version saved. Re-run to refresh the result.',
  'ok-run': 'Scenario run with the current assumptions.',
  'ok-submitted': 'Submitted and frozen. A second person must approve it.',
  'ok-approved': 'Submission approved.',
  'ok-rejected': 'Submission rejected.',
  rationale: 'Write a short rationale for the decision.',
  'own-submission': 'You cannot decide on a submission you made yourself — a second person must.',
  frozen: 'Submitted and approved scenarios are frozen and cannot be edited.',
  conflict: 'The scenario changed, or its result is stale. Re-run it, then try again.',
};

const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

/** What can be done with a scenario now, by whom. The API re-checks each action. */
function ScenarioActions({ dealId, view, viewer }: { dealId: string; view: ScenarioView; viewer: DealViewer }) {
  const { scenario } = view;
  const writer = can.draft(viewer.role);
  const pending = view.submissions.find((submission) => !view.decisions.some((decision) => decision.submissionId === submission.id));
  if (scenario.status === 'DRAFT' && writer) {
    const needsRun = !view.latestRun || view.stale === true;
    return (
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <form action={runScenario.bind(null, dealId, scenario.id, scenario.version)}>
          <Button type="submit" size="sm" variant={needsRun ? 'default' : 'outline'}>
            {view.latestRun ? 'Re-run' : 'Run'}
          </Button>
        </form>
        <Link href={`/deals/${dealId}/valuation/${scenario.id}/edit`} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
          Edit assumptions
        </Link>
        <form action={submitScenario.bind(null, dealId, scenario.id, scenario.version)}>
          <Button type="submit" size="sm" variant={needsRun ? 'ghost' : 'default'} disabled={needsRun} title={needsRun ? 'Run the current assumptions first' : undefined}>
            Submit for approval
          </Button>
        </form>
      </div>
    );
  }
  if (scenario.status === 'SUBMITTED' && pending) {
    if (!can.review(viewer.role) || pending.submittedBy === viewer.userId) {
      return (
        <p className="border-t border-border pt-4 text-muted-foreground">
          Waiting for a deal lead or reviewer other than {viewer.name(pending.submittedBy)} to approve.
        </p>
      );
    }
    return (
      <form action={decideSubmission.bind(null, dealId, scenario.id, pending.id)} className="flex flex-col gap-2 border-t border-border pt-4">
        <input type="hidden" name="expectedVersion" value={scenario.version} />
        <span className="font-medium">Your decision on this frozen submission</span>
        <textarea name="rationale" rows={2} required placeholder="Why you approve or reject it" className={inputClass} />
        <div className="flex gap-2">
          <Button type="submit" name="decision" value="APPROVED" size="sm">
            Approve
          </Button>
          <Button type="submit" name="decision" value="REJECTED" size="sm" variant="outline">
            Reject
          </Button>
        </div>
      </form>
    );
  }
  return null;
}

function ScenarioCard({ dealId, view, viewer }: { dealId: string; view: ScenarioView; viewer: DealViewer }) {
  const { scenario, latestRun } = view;
  const result = latestRun?.result;
  const fresh = freshness(view);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-2">
        <CardTitle className="mr-auto">{scenario.name}</CardTitle>
        <Badge variant={statusVariant(scenario.status)}>{scenario.status.toLowerCase()}</Badge>
        <Badge variant={fresh.variant}>{fresh.label}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        <div className="text-muted-foreground">
          {scenario.transactionType.replaceAll('_', ' ').toLowerCase()} · {scenario.currency} ·
          assumptions v{scenario.assumptionVersion}
          {latestRun ? ` · last run on assumptions v${latestRun.assumptionVersion}` : ''}
        </div>

        {view.staleReasons.length > 0 ? (
          <ul className="list-disc pl-5 text-red-800">
            {view.staleReasons.map((reason, index) => (
              <li key={`${reason.kind}-${index}`}>{describeStaleReason(reason)}</li>
            ))}
          </ul>
        ) : null}

        {!result ? (
          <EmptyState
            title="Not run yet"
            description="Run the scenario to compute enterprise value and the purchase-price bridge."
          />
        ) : (
          <>
            <div className="flex flex-wrap gap-6">
              <div>
                <div className="text-muted-foreground">Enterprise value</div>
                <div className="font-mono text-lg">{formatMoney(result.enterpriseValue)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Equity purchase price</div>
                <div className="font-mono text-lg">
                  {formatMoney(result.bridge.equityPurchasePrice)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Cash at close</div>
                <div className="font-mono text-lg">{formatMoney(result.bridge.cashAtClose)}</div>
              </div>
              <div className="self-end">
                <Badge variant="calculation">
                  {result.engineVersion} · {result.inputHash.slice(0, 12)}
                </Badge>
              </div>
            </div>

            <section className="flex flex-col gap-1">
              <h3 className="font-medium">Purchase-price bridge</h3>
              <Bridge dealId={dealId} result={result} />
            </section>

            {result.sensitivity ? <Sensitivity grid={result.sensitivity} /> : null}

            {result.lbo ? (
              <section className="flex flex-wrap gap-6">
                <h3 className="w-full font-medium">Sponsor returns (take-private)</h3>
                <div>Entry equity {formatMoney(result.lbo.entryEquity)}</div>
                <div>Exit equity {formatMoney(result.lbo.exitEquity)}</div>
                <div>MOIC {result.lbo.moic ? `${result.lbo.moic}x` : 'n/a'}</div>
                <div>IRR {formatRatio(result.lbo.irr)}</div>
              </section>
            ) : null}

            {result.accretionDilution ? (
              <section className="flex flex-wrap gap-6">
                <h3 className="w-full font-medium">Accretion / dilution (stock consideration)</h3>
                <div>New shares {formatDecimal(result.accretionDilution.newSharesIssued)}</div>
                <div>Standalone EPS {result.accretionDilution.standaloneEps}</div>
                <div>Pro-forma EPS {result.accretionDilution.proFormaEps}</div>
                <div>
                  {result.accretionDilution.accretive ? 'Accretive' : 'Dilutive'}{' '}
                  {formatRatio(result.accretionDilution.accretion)}
                </div>
              </section>
            ) : null}
          </>
        )}

        <ScenarioActions dealId={dealId} view={view} viewer={viewer} />

        {view.submissions.length > 0 ? (
          <section className="flex flex-col gap-1">
            <h3 className="font-medium">Frozen submissions</h3>
            <ul className="flex flex-col gap-1">
              {view.submissions.map((submission) => {
                const decision = view.decisions.find((d) => d.submissionId === submission.id);
                return (
                  <li key={submission.id}>
                    <span className="font-mono">sha256 {submission.digest.slice(0, 16)}</span>{' '}
                    <span className="text-muted-foreground">
                      submitted by {viewer.name(submission.submittedBy)} on {submission.submittedAt.slice(0, 10)}
                    </span>{' '}
                    {decision ? (
                      <Badge variant={decision.decision === 'APPROVED' ? 'reviewed' : 'danger'}>
                        {decision.decision.toLowerCase()}
                      </Badge>
                    ) : (
                      <Badge variant="draft">awaiting decision</Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Valuation scenarios for a deal: deterministic engine results, the
 * purchase-price bridge with accepted-finding adjustments, stale state and
 * frozen submissions. Runs, submissions and approvals go through the API.
 */
export default async function ValuationPage({
  params,
  searchParams,
}: {
  params: Promise<{ dealId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const outcome = (await searchParams)['outcome'];
  const dealId = parseDealParam((await params).dealId);
  const [result, viewer] = dealId
    ? await Promise.all([
        apiGet<{ items: ScenarioView[] }>(`/v1/deals/${encodeURIComponent(dealId)}/valuation/scenarios`),
        dealViewer(dealId),
      ])
    : [null, null];

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">Valuation · Sextant</h2>
          <p className="text-sm text-muted-foreground">
            Engines compute; people decide. Only accepted findings adjust price, and a submitted scenario is frozen.
          </p>
        </div>
        {dealId && viewer && can.draft(viewer.role) ? (
          <Link href={`/deals/${dealId}/valuation/new`} className={buttonVariants({ size: 'sm' })}>
            New scenario
          </Link>
        ) : null}
      </div>

      <OutcomeBanner outcome={typeof outcome === 'string' ? outcome : undefined} messages={OUTCOMES} />

      {!dealId || !viewer ? (
        <EmptyState
          title="Choose a deal"
          description="Open valuation from a deal to see its scenarios."
        />
      ) : result && result.kind !== 'ok' ? (
        <ApiState result={result} />
      ) : !result || result.data.items.length === 0 ? (
        <EmptyState
          title="No scenarios"
          description="Create a scenario with versioned assumptions to value this deal."
        />
      ) : (
        result.data.items.map((view) => (
          <ScenarioCard key={view.scenario.id} dealId={dealId} view={view} viewer={viewer} />
        ))
      )}
    </div>
  );
}
