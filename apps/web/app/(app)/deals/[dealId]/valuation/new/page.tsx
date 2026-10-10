import { notFound } from 'next/navigation';
import { isUuidParam } from '../../../_lib/filters';
import { ScenarioEditor } from '../_scenario-page';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

export default async function NewScenarioPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  if (!isUuidParam(dealId)) notFound();
  return <ScenarioEditor dealId={dealId} scenario={null} />;
}
