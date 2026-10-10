import { notFound, redirect } from 'next/navigation';
import type { ScenarioValues } from '../../../../../valuation/_lib/form';
import { apiGet } from '../../../../_lib/api';
import { isUuidParam } from '../../../../_lib/filters';
import { ApiState } from '../../../../_lib/states';
import { ScenarioEditor } from '../../_scenario-page';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

export default async function EditScenarioPage({ params }: { params: Promise<{ dealId: string; scenarioId: string }> }) {
  const { dealId, scenarioId } = await params;
  if (!isUuidParam(dealId) || !isUuidParam(scenarioId)) notFound();
  const current = await apiGet<{ scenario: { id: string; name: string; version: number; status: string }; assumptions: ScenarioValues }>(
    `/v1/deals/${dealId}/valuation/scenarios/${scenarioId}`,
  );
  if (current.kind !== 'ok') return <ApiState result={current} />;
  // Submitted and approved scenarios are frozen.
  if (current.data.scenario.status !== 'DRAFT') redirect(`/deals/${dealId}/valuation?outcome=frozen`);
  return (
    <ScenarioEditor
      dealId={dealId}
      scenario={{ id: scenarioId, name: current.data.scenario.name, version: current.data.scenario.version, values: current.data.assumptions }}
    />
  );
}
