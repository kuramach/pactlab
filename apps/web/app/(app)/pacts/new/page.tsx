import { packPreviewEnabled } from '@pactlab/config';
import { selectableCompanyTypes } from '@pactlab/domain';
import { PageHeader } from '@pactlab/ui';
import { redirect } from 'next/navigation';
import { getSessionContext } from '../../../../lib/session';
import { publicEnv } from '../../../../lib/env';
import { apiGet } from '../../deals/_lib/api';
import { PactWizard, type PersonaChoice } from './wizard';

// Per-user: reads the session.
export const dynamic = 'force-dynamic';

export default async function StartPactPage() {
  if ((await getSessionContext()).kind !== 'signed-in') redirect('/login');
  const persona = await apiGet<{ effective: string; options: PersonaChoice['options'] }>('/v1/organization/persona');
  const personas: PersonaChoice | null = persona.kind === 'ok' ? { defaultPersona: persona.data.effective, options: persona.data.options } : null;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        breadcrumbs={[{ href: '/', label: 'Home' }, { href: '/deals', label: 'My deals' }, { label: 'Start a Pact' }]}
        title="Start a Pact"
        description="Every Pact is a deal. Tell us who is buying and who is selling; Pactlab works out the deal type and switches on the sources worth collecting."
      />
      {/* Packs launch one at a time: released ones only, or every type in preview (dev, qa), unreleased ones marked. */}
      <PactWizard personas={personas} companyTypes={selectableCompanyTypes(packPreviewEnabled(publicEnv().NEXT_PUBLIC_APP_ENV, process.env['PACK_PREVIEW'] === 'true' ? 'true' : process.env['PACK_PREVIEW'] === 'false' ? 'false' : undefined))} />
    </div>
  );
}
