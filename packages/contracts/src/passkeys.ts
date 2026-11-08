import { z } from 'zod';

/** One of the signed-in user's passkeys (T-108); never the key itself. */
export interface PasskeyView {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** Where the passkey lives, as the browser reported it (e.g. internal, hybrid). */
  transports: string[];
}

export interface PasskeysView {
  passkeys: PasskeyView[];
  /** Adding needs a sign-in within the last 15 minutes. */
  canAdd: boolean;
  /** Show the one-time "add a passkey" offer. */
  offer: boolean;
}

/** WebAuthn options for the browser, with the id of the single-use challenge behind them. */
export interface PasskeyOptionsView {
  challengeId: string;
  /** PublicKeyCredentialCreationOptionsJSON or PublicKeyCredentialRequestOptionsJSON. */
  options: Record<string, unknown>;
}

export const passkeyNameSchema = z.string().trim().min(1).max(60);
