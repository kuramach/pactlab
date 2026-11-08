'use client';

import { Button } from '@pactlab/ui';
import { browserSupportsWebAuthn, browserSupportsWebAuthnAutofill, startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { Fingerprint } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { completePasskeySignIn, passkeySignInOptions } from './passkey-actions';

/**
 * "Sign in with a passkey" (T-108), plus the browser's passkey suggestions on the email
 * field (autofill). Face ID, Touch ID, Windows Hello, or a phone over the browser's QR code.
 * Shown only where the browser supports passkeys.
 */
export function PasskeySignIn({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function run(autofill: boolean) {
    const started = await passkeySignInOptions();
    if (!started) {
      if (!autofill) setFailed(true);
      return;
    }
    let response;
    try {
      response = await startAuthentication({ optionsJSON: started.options as unknown as PublicKeyCredentialRequestOptionsJSON, useBrowserAutofill: autofill });
    } catch {
      // Cancelled, timed out, or replaced by the other way in: nothing to say for autofill.
      if (!autofill) setFailed(true);
      return;
    }
    setBusy(true);
    const next = await completePasskeySignIn(started.challengeId, response, returnTo);
    if (next) {
      router.replace(next);
      router.refresh();
      return;
    }
    setBusy(false);
    setFailed(true);
  }

  useEffect(() => {
    if (!browserSupportsWebAuthn()) return;
    setSupported(true);
    void browserSupportsWebAuthnAutofill().then((autofill) => {
      if (autofill) void run(true);
    });
    // Once per page load (autofill); the button starts its own ceremony.
  }, []);

  if (!supported) return null;
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => {
          setFailed(false);
          void run(false);
        }}
      >
        <Fingerprint className="h-4 w-4" aria-hidden /> {busy ? 'Signing in…' : 'Sign in with a passkey'}
      </Button>
      {failed ? (
        <p role="alert" className="text-sm text-muted-foreground">
          That passkey didn’t sign you in. Try again, or use an email code below.
        </p>
      ) : null}
    </div>
  );
}
