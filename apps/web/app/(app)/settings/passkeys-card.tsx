import type { PasskeysView } from '@pactlab/contracts';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pactlab/ui';
import { Fingerprint } from 'lucide-react';
import { passkeyOfferPending } from '../../../lib/native-session';
import { apiGet } from '../deals/_lib/api';
import { dismissPasskeyOffer, removePasskey } from './passkey-actions';
import { PasskeyAdd } from './passkey-add';

const WHERE: Record<string, string> = { internal: 'this device', hybrid: 'a phone', usb: 'a security key', nfc: 'a security key', ble: 'a security key' };
const day = (iso: string) => iso.slice(0, 10);

/** Settings → Sign-in (T-108): the person's passkeys, for email-code organizations. */
export async function PasskeysCard() {
  const result = await apiGet<PasskeysView>('/v1/me/passkeys');
  if (result.kind !== 'ok') return null;
  const { passkeys, canAdd } = result.data;
  return (
    <Card id="sign-in">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Fingerprint className="h-4 w-4" aria-hidden /> Sign-in
        </CardTitle>
        <CardDescription>
          Sign in with a passkey instead of an emailed code: Face ID, Touch ID, Windows Hello, or your phone. Your fingerprint or face never leaves your device; Pactlab
          keeps only a public key. The email code always works too.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {passkeys.length > 0 ? (
          <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Your passkeys">
            {passkeys.map((key) => (
              <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="flex flex-col">
                  <span className="font-medium">{key.name}</span>
                  <span className="text-xs text-muted-foreground">
                    Added {day(key.createdAt)}
                    {key.transports[0] && WHERE[key.transports[0]] ? ` on ${WHERE[key.transports[0]]}` : ''} · {key.lastUsedAt ? `last used ${day(key.lastUsedAt)}` : 'not used yet'}
                  </span>
                </span>
                <form action={removePasskey.bind(null, key.id)}>
                  <Button type="submit" size="sm" variant="ghost" aria-label={`Remove ${key.name}`}>
                    Remove
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No passkeys yet.</p>
        )}
        {canAdd ? (
          <PasskeyAdd />
        ) : passkeys.length >= 10 ? (
          <p className="text-sm text-muted-foreground">You have the most passkeys allowed (10). Remove one to add another.</p>
        ) : (
          <p className="text-sm text-muted-foreground">To add a passkey, sign in with an email code; you then have 15 minutes to add one.</p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The one-time offer after an email sign-in (T-108): shown for 15 minutes after signing in,
 * until a passkey is added or the person says "Not now" (remembered on their account).
 */
export async function PasskeyOffer() {
  if (!(await passkeyOfferPending())) return null;
  const result = await apiGet<PasskeysView>('/v1/me/passkeys');
  if (result.kind !== 'ok' || !result.data.offer || !result.data.canAdd) return null;
  return (
    <aside aria-label="Add a passkey" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-indigo/30 bg-indigo/5 px-4 py-3 text-sm">
      <Fingerprint className="h-5 w-5 text-indigo-ink" aria-hidden />
      <span className="mr-auto">
        <span className="font-semibold">Sign in faster next time.</span> Add a passkey and use Face ID, Touch ID or your phone instead of an emailed code.
      </span>
      <PasskeyAdd compact />
      <form action={dismissPasskeyOffer}>
        <Button type="submit" size="sm" variant="ghost">
          Not now
        </Button>
      </form>
    </aside>
  );
}
