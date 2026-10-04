import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from '@pactlab/ui';
import Link from 'next/link';
import { apiGet } from '../deals/_lib/api';
import { ApiState } from '../deals/_lib/states';
import { formatDecimal, formatMoney, formatRatio } from '../metrics/_lib/format';
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
} from './_lib/view';

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
                    href={`/findings?deal=${dealId}`}
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

function ScenarioCard({ dealId, view }: { dealId: string; view: ScenarioView }) {
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

        {view.submissions.length > 0 ? (
          <section className="flex flex-col gap-1">
            <h3 className="font-medium">Frozen submissions</h3>
            <ul className="flex flex-col gap-1">
              {view.submissions.map((submission) => {
                const decision = view.decisions.find((d) => d.submissionId === submission.id);
                return (
                  <li key={submission.id}>
                    <span className="font-mono">sha256 {submission.digest.slice(0, 16)}</span>{' '}
                    <span className="text-muted-foreground">submitted {submission.submittedAt}</span>{' '}
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
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const dealId = parseDealParam((await searchParams)['deal']);
  const result = dealId
    ? await apiGet<{ items: ScenarioView[] }>(
        `/v1/deals/${encodeURIComponent(dealId)}/valuation/scenarios`,
      )
    : null;

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Valuation</h1>
        <p className="text-sm text-muted-foreground">
          Engines compute; people decide. Only accepted findings adjust price, and a submitted
          scenario is frozen.
        </p>
      </header>

      {!dealId ? (
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
          <ScenarioCard key={view.scenario.id} dealId={dealId} view={view} />
        ))
      )}
    </div>
  );
}
