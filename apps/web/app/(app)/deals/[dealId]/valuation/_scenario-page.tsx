import type { Finding } from '@pactlab/domain';
import Link from 'next/link';
import { formatPricedRisk } from '../../../findings/_lib/view';
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
  const [deal, accepted] = await Promise.all([
    dealsApi.get(dealId),
    apiGet<{ items: Finding[] }>(`/v1/deals/${dealId}/findings?status=ACCEPTED`),
  ]);
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
        submitLabel={scenario ? 'Save new version' : 'Create scenario'}
      />
    </div>
  );
}
