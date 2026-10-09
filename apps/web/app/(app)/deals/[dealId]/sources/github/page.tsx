import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { dealsApi } from '../../../_lib/api';
import { isUuidParam } from '../../../_lib/filters';
import { ConnectGitHubForm } from './connect-form';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

/** Connect a seller repository live: Pactlab's GitHub App or a read-only token. */
export default async function ConnectGitHubPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  if (!isUuidParam(dealId)) notFound();
  const app = await dealsApi.githubApp();
  const installUrl = app.kind === 'ok' ? app.data.installUrl : null;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link href={`/deals/${dealId}/sources`} className="text-sm text-muted-foreground hover:underline">
          ← Sources
        </Link>
        <h2 className="text-lg font-semibold tracking-tight">Connect GitHub</h2>
        <p className="text-sm text-muted-foreground">
          Pactlab reads commit history only — who changed what and when. It never copies source code.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Repository access</CardTitle>
          <CardDescription>
            {installUrl
              ? 'Choose how the seller grants read-only access.'
              : 'The Pactlab GitHub App is not set up on this server, so connect with a read-only token.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ConnectGitHubForm dealId={dealId} installUrl={installUrl} />
        </CardContent>
      </Card>
    </div>
  );
}
