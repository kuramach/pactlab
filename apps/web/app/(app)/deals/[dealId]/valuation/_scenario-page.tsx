import type { BalanceSheetView, BenchmarkView } from '@pactlab/contracts';
import type { Finding } from '@pactlab/domain';
import Link from 'next/link';
import { describeSet, formatMultiple } from '../../../comparables/_lib/view';
import { formatPricedRisk } from '../../../findings/_lib/view';
import { formatMoney } from '../../../metrics/_lib/format';
import type { ScenarioValues } from '../../../valuation/_lib/form';
import { apiGet, dealsApi } from '../../_lib/api';
import { saveScenario } from './actions';
import { ScenarioForm } from './scenario-form';

/** Shared body of the new and edit scenario pages. */
export async function ScenarioEditor({
  dealId,
  scenario,
}: {
  dealId: string;
  scenario: { id: string; name: string; version: number; values: ScenarioValues } | null;
}) {
  const [deal, accepted, benchmark, sheet] = await Promise.all([
    dealsApi.get(dealId),
    apiGet<{ items: Finding[] }>(`/v1/deals/${dealId}/findings?status=ACCEPTED`),
    apiGet<BenchmarkView>(`/v1/deals/${dealId}/benchmark`),
    apiGet<BalanceSheetView>(`/v1/deals/${dealId}/balance-sheet-items`),
  ]);
  const stats = benchmark.kind === 'ok' ? benchmark.data.stats : null;
  const multipleHint =
    benchmark.kind === 'ok' && stats
      ? `Comparables: middle half ${formatMultiple(stats.p25)}–${formatMultiple(stats.p75)}, median ${formatMultiple(stats.median)} (${describeSet(benchmark.data)}${benchmark.data.syntheticCount > 0 ? `, ${benchmark.data.syntheticCount} synthetic` : ''}).${benchmark.data.askingImplied ? ` The ask implies ${formatMultiple(benchmark.data.askingImplied.multiple)}.` : ''}`
      : undefined;
  const priced = accepted.kind === 'ok' ? accepted.data.items.filter((finding) => finding.pricedRisk) : [];
  const action = saveScenario.bind(null, dealId, scenario?.id ?? null, scenario?.version ?? null);
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={`/deals/${dealId}/valuation`} className="text-sm text-muted-foreground hover:underline">
          ← Valuation
        </Link>
        <h2 className="text-lg font-semibold tracking-tight">{scenario ? `Edit ${scenario.name}` : 'New scenario'}</h2>
        <p className="text-sm text-muted-foreground">
          {scenario
            ? 'Saving creates a new assumption version; re-run the scenario afterwards.'
            : 'Assumptions are versioned. Run the scenario after saving to compute value and the bridge.'}
        </p>
      </div>
      <ScenarioForm
        action={action}
        name={scenario?.name ?? ''}
        values={scenario?.values ?? null}
        currency={deal.kind === 'ok' ? (deal.data.baseCurrency ?? 'USD') : 'USD'}
        takePrivate={deal.kind === 'ok' && deal.data.transactionType === 'TAKE_PRIVATE'}
        accepted={priced.map((finding) => ({ id: finding.id, title: finding.title, price: formatPricedRisk(finding.pricedRisk) }))}
        items={
          sheet.kind === 'ok'
            ? sheet.data.items.map((item) => ({
                id: item.id,
                kind: item.kind,
                label: item.label,
                amount: formatMoney({ amount: item.amount, currency: item.currency }),
                source: `${item.citation.documentName ?? 'Document'}, p. ${item.citation.pageNumber}`,
                citationValid: item.citationValid,
              }))
            : []
        }
        submitLabel={scenario ? 'Save new version' : 'Create scenario'}
        multipleHint={multipleHint}
      />
    </div>
  );
}
