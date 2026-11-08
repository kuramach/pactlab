'use client';

import { Button } from '@pactlab/ui';
import { browserSupportsWebAuthn, startRegistration, type PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { Fingerprint } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { passkeyRegistrationOptions, savePasskey } from './passkey-actions';

/** A starting name for the passkey from the device in hand; the user can change it. */
function deviceName(): string {
  const agent = navigator.userAgent;
  if (/iPhone/.test(agent)) return 'iPhone';
  if (/iPad/.test(agent)) return 'iPad';
  if (/Android/.test(agent)) return 'Android phone';
  if (/Macintosh/.test(agent)) return 'Mac';
  if (/Windows/.test(agent)) return 'Windows PC';
  return 'Passkey';
}

const MESSAGES = {
  reauth: 'For your security, a passkey can be added only within 15 minutes of signing in with an email code. Sign out, sign in again, then add it.',
  failed: 'The passkey wasn’t added. Try again; if your device asked nothing, it may not support passkeys.',
  cancelled: 'Cancelled. Nothing was added.',
} as const;

/**
 * Add a passkey (T-108): the device asks for Face ID, Touch ID, Windows Hello or its PIN,
 * or the browser offers a QR code to use a phone. Hidden where passkeys aren't supported.
 */
export function PasskeyAdd({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [supported, setSupported] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<keyof typeof MESSAGES | null>(null);

  useEffect(() => {
    if (!browserSupportsWebAuthn()) return;
    setSupported(true);
    setName(deviceName());
  }, []);

  async function add() {
    setBusy(true);
    setMessage(null);
    const options = await passkeyRegistrationOptions();
    if (options.kind !== 'ok') {
      setBusy(false);
      setMessage(options.kind);
      return;
    }
    let response;
    try {
      response = await startRegistration({ optionsJSON: options.started.options as unknown as PublicKeyCredentialCreationOptionsJSON });
    } catch {
      setBusy(false);
      setMessage('cancelled');
      return;
    }
    const saved = await savePasskey(options.started.challengeId, name, response);
    setBusy(false);
    if (saved.kind !== 'ok') {
      setMessage(saved.kind);
      return;
    }
    router.refresh();
  }

  if (!supported) return compact ? null : <p className="text-sm text-muted-foreground">This browser doesn’t support passkeys.</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        {compact ? null : (
          <label className="flex flex-col gap-1 text-sm font-medium">
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} className="w-56 rounded-md border border-border bg-background px-3 py-2 text-sm" />
          </label>
        )}
        <Button type="button" size="sm" disabled={busy} onClick={() => void add()}>
          <Fingerprint className="h-4 w-4" aria-hidden /> {busy ? 'Waiting for your device…' : 'Add a passkey'}
        </Button>
      </div>
      {message ? (
        <p role="alert" className="text-sm text-muted-foreground">
          {MESSAGES[message]}
        </p>
      ) : null}
    </div>
  );
}
