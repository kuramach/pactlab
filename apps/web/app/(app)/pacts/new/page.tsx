import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionContext } from '../../../../lib/session';
import { PactWizard } from './wizard';

// Per-user: reads the session.
export const dynamic = 'force-dynamic';

export default async function StartPactPage() {
  if ((await getSessionContext()).kind !== 'signed-in') redirect('/login');
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link href="/deals" className="text-sm text-muted-foreground hover:underline">
          ← Deals
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Start a Pact</h1>
        <p className="text-sm text-muted-foreground">
          Every Pact is a deal. Tell us who is buying and who is selling; Pactlab works out the deal type and switches on
          the sources worth collecting.
        </p>
      </header>
      <PactWizard />
    </div>
  );
}
