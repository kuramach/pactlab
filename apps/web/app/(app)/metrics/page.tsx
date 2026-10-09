import { redirect } from 'next/navigation';

/** Finances now live inside each deal. */
export default function MetricsIndexPage(): never {
  redirect('/deals');
}
