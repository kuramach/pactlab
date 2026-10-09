import { PageHeader } from '@pactlab/ui';
import { redirect } from 'next/navigation';
import { getSessionContext } from '../../../../lib/session';
import { PactWizard } from './wizard';

// Per-user: reads the session.
export const dynamic = 'force-dynamic';

export default async function StartPactPage() {
  if ((await getSessionContext()).kind !== 'signed-in') redirect('/login');
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ href: '/', label: 'Home' }, { href: '/deals', label: 'My deals' }, { label: 'Start a Pact' }]}
        title="Start a Pact"
        description="Every Pact is a deal. Tell us who is buying and who is selling; Pactlab works out the deal type and switches on the sources worth collecting."
      />
      <PactWizard />
    </div>
  );
}
