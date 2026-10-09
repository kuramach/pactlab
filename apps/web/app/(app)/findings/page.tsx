import { redirect } from 'next/navigation';
import { legacyDealPath } from '../deals/_lib/legacy';

/** Old address: findings now live inside each deal. */
export default async function LegacyFindingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  redirect(legacyDealPath('findings', await searchParams));
}
