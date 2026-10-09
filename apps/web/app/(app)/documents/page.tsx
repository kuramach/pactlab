import { redirect } from 'next/navigation';
import { legacyDealPath } from '../deals/_lib/legacy';

/** Old address: documents now live inside each deal. */
export default async function LegacyDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  redirect(legacyDealPath('documents', await searchParams));
}
