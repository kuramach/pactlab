import { redirect } from 'next/navigation';
import { isUuidParam } from '../../deals/_lib/filters';

/** Old address of a deal's finances. */
export default async function LegacyMetricsPage({ params }: { params: Promise<{ dealId: string }> }): Promise<never> {
  const { dealId } = await params;
  redirect(isUuidParam(dealId) ? `/deals/${dealId}/finances` : '/deals');
}
