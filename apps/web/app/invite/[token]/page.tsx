import { Badge, Button, buttonVariants, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import Link from 'next/link';
import { publicEnv } from '../../../lib/env';
import { getSessionContext } from '../../../lib/session';
import { AuthFrame } from '../../_components/auth-frame';
import { acceptInvitation, confirmInviteSignup, signOutForInvite, startInviteSignup } from './actions';

interface Preview {
  dealName: string;
  organizationName: string;
  email: string;
  side: 'BUYER' | 'SELLER' | 'ADVISOR' | 'BIDDER';
  role: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  expiresAt: string;
}

const SIDE = { BUYER: 'on the buying team', SELLER: 'for the seller', ADVISOR: 'as an advisor', BIDDER: 'as a bidder' } as const;
const ROLE: Record<string, string> = {
  TARGET_CONTRIBUTOR: 'Seller contributor — you share what is asked and see what is shared with you',
  ADVISER: 'Advisor — read the evidence',
  VIEWER: 'Viewer — read only',
  ANALYST: 'Analyst — work the diligence',
  REVIEWER: 'Reviewer — decide findings',
  INVESTMENT_COMMITTEE: 'Investment committee — decide the deal',
};
const ERRORS: Record<string, string> = {
  'not-accepted': 'This invitation is for a different address than the one you are signed in with. Sign out below and continue as the invited address.',
  switch: 'You joined the pact, but switching to it failed. Use the organization switcher to open it.',
  details: 'Enter your name and your company name.',
  unavailable: 'Sign-up is not available right now. Try again shortly.',
  expired: 'That code expired. Start again.',
  code: 'That code was not right. Check the email and try again.',
};
const inputClass = 'w-full rounded-md border border-border bg-background px-3 py-2 text-sm';

async function preview(token: string): Promise<Preview | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  try {
    const response = await fetch(new URL(`/v1/invitations/${token}`, publicEnv().NEXT_PUBLIC_API_ORIGIN), { cache: 'no-store' });
    return response.ok ? ((await response.json()) as Preview) : null;
  } catch {
    return null;
  }
}

/**
 * A pact invitation (T-094 B12). Shows whose pact, which side and role, for
 * which address; then sign in (existing account) or create an account with
 * the invited address, and accept. Joining a pact never joins the company.
 */
export default async function InvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ step?: string; error?: string }> }) {
  const { token } = await params;
  const query = await searchParams;
  const invite = await preview(token);
  const session = await getSessionContext();
  const signedIn = session.kind === 'signed-in';
  const signedInAs = session.kind === 'signed-in' ? session.email : null;
  // Signed in as someone else (batch 1): offer to switch instead of failing on accept.
  const otherAddress = signedIn && invite !== null && signedInAs !== null && signedInAs.toLowerCase() !== invite.email.toLowerCase();
  const error = query.error ? ERRORS[query.error] : undefined;

  return (
    <AuthFrame>
      <Card className="w-full shadow-xl shadow-navy/10">
        {!invite ? (
          <CardHeader>
            <CardTitle>Invitation not found</CardTitle>
            <CardDescription>The link is incomplete or no longer exists. Ask whoever invited you to send a new one.</CardDescription>
          </CardHeader>
        ) : (
          <>
            <CardHeader>
              <CardTitle>You are invited to {invite.dealName}</CardTitle>
              <CardDescription>
                {invite.organizationName} invited <strong>{invite.email}</strong> {SIDE[invite.side]}. You join this pact only — not {invite.organizationName}.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{ROLE[invite.role] ?? invite.role}</Badge>
                {invite.status !== 'PENDING' ? <Badge variant="danger">{invite.status === 'ACCEPTED' ? 'Already accepted' : invite.status === 'REVOKED' ? 'Withdrawn' : 'Expired'}</Badge> : null}
              </div>
              {error ? (
                <p role="alert" className="rounded-md border border-border bg-muted px-3 py-2">
                  {error}
                </p>
              ) : null}
              {invite.status !== 'PENDING' ? (
                <p className="text-muted-foreground">This invitation can no longer be used. Ask whoever invited you to send a new one.</p>
              ) : otherAddress ? (
                <div className="flex flex-col gap-3">
                  <p>
                    You’re signed in as <strong>{signedInAs}</strong>. This invitation is for <strong>{invite.email}</strong>.
                  </p>
                  <form action={signOutForInvite.bind(null, token)}>
                    <Button type="submit" className="w-full sm:w-auto">
                      Sign out and continue
                    </Button>
                  </form>
                </div>
              ) : signedIn ? (
                <div className="flex flex-col gap-3">
                  {signedInAs ? <p className="text-muted-foreground">Signed in as {signedInAs}.</p> : null}
                  <form action={acceptInvitation.bind(null, token)}>
                    <Button type="submit">Accept and open the pact</Button>
                  </form>
                </div>
              ) : query.step === 'code' ? (
                <form action={confirmInviteSignup.bind(null, token)} className="flex flex-col gap-3">
                  <p className="text-muted-foreground">We emailed a 6-digit code to {invite.email}. It expires in 10 minutes.</p>
                  <label className="flex flex-col gap-1 font-medium">
                    6-digit code
                    <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required className={inputClass} />
                  </label>
                  <Button type="submit">Create account and join</Button>
                </form>
              ) : (
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <p className="font-semibold">Already use Pactlab?</p>
                    <p className="text-muted-foreground">Sign in with {invite.email}.</p>
                    <Link href={`/login?${new URLSearchParams({ returnTo: `/invite/${token}` })}`} className={buttonVariants({ variant: 'outline', className: 'mt-auto w-full' })}>
                      Sign in
                    </Link>
                  </div>
                  <form action={startInviteSignup.bind(null, token, invite.email)} className="flex flex-col gap-2">
                    <p className="font-semibold">New to Pactlab?</p>
                    <label className="flex flex-col gap-1">
                      Your name
                      <input name="displayName" required maxLength={120} autoComplete="name" className={inputClass} />
                    </label>
                    <label className="flex flex-col gap-1">
                      Your company
                      <input name="organizationName" required minLength={2} maxLength={120} autoComplete="organization" className={inputClass} />
                    </label>
                    <Button type="submit" className="mt-auto w-full">
                      Create account
                    </Button>
                  </form>
                </div>
              )}
            </CardContent>
          </>
        )}
      </Card>
    </AuthFrame>
  );
}
