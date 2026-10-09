import { redirect } from 'next/navigation';
import { legacyDealPath } from '../deals/_lib/legacy';

/** Old address: valuation now live inside each deal. */
export default async function LegacyValuationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  redirect(legacyDealPath('valuation', await searchParams));
}
