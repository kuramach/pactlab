import { AuthFrame } from '../_components/auth-frame';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { publicEnv } from '../../lib/env';
import { getSessionContext } from '../../lib/session';
import { confirmSignup, startSignup } from './actions';

// Per-request: reads cookies and query state.
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  details: 'Fill in your name, your organization (at least 2 characters) and a valid email address.',
  'sso-work-email': 'Company single sign-on needs your work email address. Use it, or untick SSO to continue with this address and sign in with codes.',
  code: 'That code did not work. Check it, or start again for a new one.',
  expired: 'Your sign-up attempt expired. Start again.',
  unavailable: 'Sign-up is unavailable right now. Try again shortly.',
  // Promo codes (T-087).
  'promo-UNKNOWN': 'That promo code isn’t one we know. Check it, or leave it empty to sign up without it.',
  'promo-INACTIVE': 'That promo code is no longer active. Leave it empty to sign up without it.',
  'promo-NOT_YET': 'That promo code isn’t active yet. Leave it empty, or try again from its start date.',
  'promo-EXPIRED': 'That promo code has expired. Leave it empty to sign up without it.',
  'promo-USED_UP': 'That promo code has been fully used. Leave it empty to sign up without it.',
  'promo-RATE_LIMITED': 'Too many code attempts from here. Wait an hour, or sign up without a code.',
};

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

/**
 * Create an organization. It signs in with emailed one-time codes; company
 * SSO (Auth0) can be requested here and is set up with the Pactlab team.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; error?: string }>;
}) {
  const params = await searchParams;
  if ((await getSessionContext()).kind === 'signed-in') redirect('/');
  const error = params.error ? ERRORS[params.error] : undefined;
  const step = params.step ?? 'details';

  return (
    <AuthFrame>
      <Card className="w-full shadow-xl shadow-navy/10">
        {step === 'pending' || step === 'ready' ? (
          <>
            <CardHeader>
              <CardTitle>{step === 'pending' ? 'Thanks — we’re reviewing your organization' : 'Your organization is ready'}</CardTitle>
              <CardDescription>
                {step === 'pending'
                  ? 'We review new organizations during the pilot. You’ll get an email at the address you used as soon as it’s approved.'
                  : 'Log in with the email address you used to sign up.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/login" className="text-sm font-medium text-indigo-ink underline">
                Go to log in
              </Link>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle>Create your organization</CardTitle>
              <CardDescription>
                {step === 'code'
                  ? `Enter the 6-digit code we emailed you. It expires in 10 minutes.${publicEnv().NEXT_PUBLIC_APP_ENV === 'local' ? ' (Local development: run pnpm login:code to see it.)' : ''}`
                  : 'Your team signs in with one-time codes sent to their email. A work or personal address both work.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {error ? (
                <p role="alert" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
                  {error}
                </p>
              ) : null}
              {step === 'code' ? (
                <form action={confirmSignup} className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    6-digit code
                    <input
                      name="code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      autoFocus
                      className={`${inputClass} tracking-[0.4em]`}
                    />
                  </label>
                  <Button type="submit">Create organization</Button>
                  <Link href="/signup" className="text-center text-sm underline">
                    Start again
                  </Link>
                </form>
              ) : (
                <form action={startSignup} className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    Organization name
                    <input name="organizationName" required minLength={2} maxLength={120} autoComplete="organization" className={inputClass} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    Your name
                    <input name="displayName" required maxLength={120} autoComplete="name" className={inputClass} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    Email
                    <input name="email" type="email" required autoComplete="email" className={inputClass} />
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <input name="ssoRequested" type="checkbox" className="mt-1" />
                    <span>
                      We’ll need company single sign-on (SSO) through our identity provider.{' '}
                      <span className="text-muted-foreground">We’ll set it up with you; until then, codes work.</span>
                    </span>
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    Promo code <span className="font-normal text-muted-foreground">(optional)</span>
                    <input name="promoCode" maxLength={40} pattern="[A-Za-z0-9-]{4,40}" autoComplete="off" className={`${inputClass} uppercase`} />
                  </label>
                  <Button type="submit">Email me a code</Button>
                </form>
              )}
              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{' '}
                <Link href="/login" className="font-medium text-indigo-ink underline">
                  Log in
                </Link>
              </p>
            </CardContent>
          </>
        )}
      </Card>
    </AuthFrame>
  );
}
