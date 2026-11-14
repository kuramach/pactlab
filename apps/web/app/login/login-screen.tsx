import { AuthFrame, type AuthBrand } from '../_components/auth-frame';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { redirect } from 'next/navigation';
import { loginPath, safeReturnTo } from '../../lib/auth-flow';
import { auth0 } from '../../lib/auth0';
import { publicEnv } from '../../lib/env';
import { getSessionContext } from '../../lib/session';
import { requestCode, submitCode } from './actions';
import { TRUST_CHOICES, TRUST_FIELD_ID } from '../../lib/device-label';
import { PasskeySignIn } from './passkey-sign-in';

const ERRORS: Record<string, string> = {
  email: 'Enter a valid email address.',
  code: 'That code did not work. Check it, or request a new one.',
  expired: 'Your sign-in attempt expired. Request a new code.',
  unavailable: 'Sign-in by email is unavailable right now. Try again shortly.',
};

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

export type LoginParams = { returnTo?: string | string[]; step?: string; error?: string; reauth?: string; ended?: string };

/**
 * The sign-in screen: Pactlab's (`/login`), or an organization's own (`/login/<slug>`, T-123),
 * which wears its logo and colors and keeps that page through the code step.
 */
export async function LoginScreen({ params, brand }: { params: LoginParams; brand?: AuthBrand & { slug: string } }) {
  const returnTo = safeReturnTo(params.returnTo);
  // A step-up (T-112) asks a signed-in person to sign in again before a sensitive action.
  const reauth = params.reauth === '1';
  if (!reauth && (await getSessionContext()).kind === 'signed-in') redirect(returnTo);
  const error = params.error ? ERRORS[params.error] : undefined;
  const codeStep = params.step === 'code';
  const auth0Enabled = auth0() !== null;

  return (
    <AuthFrame {...(brand ? { brand } : {})}>
      <Card className="w-full shadow-xl shadow-navy/10">
        <CardHeader>
          <CardTitle>{brand ? `Sign in to ${brand.name}` : 'Sign in to Pactlab'}</CardTitle>
          <CardDescription>Use the sign-in method your organization chose.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {params.ended === '1' && !codeStep ? (
            <p role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
              You were signed out on this device. Sign in again to continue.
            </p>
          ) : null}
          {reauth && !codeStep ? (
            <p role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
              For your security, sign in again to continue. This is needed for sensitive actions when your sign-in is more than 8 hours old.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
              {error}
            </p>
          ) : null}

          {codeStep ? (
            <form action={submitCode} className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                If that address has a Pactlab account, we have emailed it a 6-digit code. It expires in 10 minutes.
              </p>
              {/* Codes go only to existing accounts (the page never reveals which): point newcomers to sign-up. */}
              <p className="text-sm text-muted-foreground">
                No email after a minute? Check spam, or you may not have an account yet:{' '}
                <a href="/signup" className="font-medium text-foreground underline underline-offset-4">
                  sign up
                </a>
                .
              </p>
              {publicEnv().NEXT_PUBLIC_APP_ENV === 'local' ? (
                <p className="rounded-md border border-dashed border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
                  Local development: codes are not emailed. Run <code className="font-mono text-foreground">pnpm login:code</code> in the
                  project folder to see the latest one.
                </p>
              ) : null}
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
              <input type="hidden" name="returnTo" value={returnTo} />
              {reauth ? <input type="hidden" name="reauth" value="1" /> : null}
              {brand ? <input type="hidden" name="brand" value={brand.slug} /> : null}
              <Button type="submit">Sign in</Button>
              <a href={`${brand ? `/login/${brand.slug}` : '/login'}?${new URLSearchParams({ returnTo, ...(reauth ? { reauth: '1' } : {}) })}`} className="text-center text-sm underline">
                Use a different address or request a new code
              </a>
            </form>
          ) : (
            <>
              {auth0Enabled ? (
                <>
                  <a
                    href={loginPath(returnTo)}
                    className="rounded-md border border-border px-4 py-2 text-center text-sm font-medium hover:bg-muted"
                  >
                    Continue with Auth0 or company SSO
                  </a>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />
                    or
                    <span className="h-px flex-1 bg-border" />
                  </div>
                </>
              ) : null}
              <label className="flex flex-col gap-1 text-sm font-medium">
                Stay signed in on this device?
                <select id={TRUST_FIELD_ID} name="trust" form="email-sign-in" defaultValue="8h" className={inputClass}>
                  {TRUST_CHOICES.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
                <span className="text-xs font-normal text-muted-foreground">Only on a computer or phone you trust. Your organization may set a shorter limit.</span>
              </label>
              <PasskeySignIn returnTo={returnTo} />
              <form id="email-sign-in" action={requestCode} className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-sm font-medium">
                  Email
                  {/* `webauthn` lets the browser suggest a saved passkey right here (T-108). */}
                  <input name="email" type="email" autoComplete="email webauthn" required className={inputClass} />
                </label>
                <input type="hidden" name="returnTo" value={returnTo} />
                {reauth ? <input type="hidden" name="reauth" value="1" /> : null}
                {brand ? <input type="hidden" name="brand" value={brand.slug} /> : null}
                <Button type="submit">Email me a sign-in code</Button>
              </form>
            </>
          )}
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        New to Pactlab?{' '}
        <a href="/signup" className="font-medium text-indigo-ink underline">
          Create an organization
        </a>
      </p>
    </AuthFrame>
  );
}
