import { AuthFrame } from '../_components/auth-frame';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from '@pactlab/ui';
import { redirect } from 'next/navigation';
import { organizationLoginPath, organizationStep, safeReturnTo } from '../../lib/auth-flow';
import { getMe } from '../../lib/session';
import { signOut } from '../_actions/sign-out';
import { chooseOrganization } from './actions';

// Per-user data: never prerender.
export const dynamic = 'force-dynamic';

function SignOut() {
  return (
    <form action={signOut}>
      <button type="submit" className="text-sm underline">
        Sign out
      </button>
    </form>
  );
}

/**
 * After login the token may lack an organization. One Auth0 membership
 * re-authorizes silently; otherwise a picker (cookies for email-code
 * sessions can only be set from its server action). Tokens used for API
 * calls always carry an organization.
 */
export default async function SelectOrganizationPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const returnTo = safeReturnTo((await searchParams).returnTo);
  const me = await getMe();
  if (me.kind !== 'ok') {
    return (
      <AuthFrame>
        <div className="flex flex-col items-center gap-4 text-center">
        <EmptyState
          title={me.kind === 'signed-out' ? 'No Pactlab account' : 'Something went wrong'}
          description={
            me.kind === 'signed-out'
              ? 'You signed in, but no Pactlab account is linked to this identity.'
              : 'Your organizations could not be loaded. Try again shortly.'
          }
        />
        <SignOut />
        </div>
      </AuthFrame>
    );
  }

  const step = organizationStep(me.data.organizations);
  if (step.kind === 'single' && step.organization.auth0OrganizationId) {
    redirect(organizationLoginPath(step.organization.auth0OrganizationId, returnTo));
  }
  const choices = step.kind === 'single' ? [step.organization] : step.kind === 'pick' ? step.organizations : [];
  if (step.kind === 'none') {
    return (
      <AuthFrame>
        <div className="flex flex-col items-center gap-4 text-center">
        <EmptyState
          title="No organization membership"
          description="Ask an organization administrator to invite you."
        />
        <SignOut />
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <Card className="w-full shadow-xl shadow-navy/10">
        <CardHeader>
          <CardTitle>Choose an organization</CardTitle>
          <CardDescription>Signed in as {me.data.user.displayName}.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {choices.map((organization) => (
            <form key={organization.id} action={chooseOrganization}>
              <input type="hidden" name="organizationId" value={organization.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <Button type="submit" className="w-full justify-between">
                <span>{organization.name}</span>
                <span className="text-xs opacity-80">
                  {organization.role.replaceAll('_', ' ').toLowerCase()}
                </span>
              </Button>
            </form>
          ))}
          <SignOut />
        </CardContent>
      </Card>
    </AuthFrame>
  );
}
