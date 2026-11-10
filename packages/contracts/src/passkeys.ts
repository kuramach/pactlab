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

/** One device where the person is signed in (T-112). */
export interface SignedInDeviceView {
  id: string;
  /** e.g. "Chrome on macOS"; null for sign-ins from before T-112 or without one. */
  deviceLabel: string | null;
  trusted: boolean;
  signedInAt: string;
  lastSeenAt: string;
  expiresAt: string;
  /** The device making this request. */
  current: boolean;
}

export interface SignedInDevicesView {
  devices: SignedInDeviceView[];
}

/** The organization's cap on a trusted sign-in, in hours: 0 (off), 24, 168 or 720. */
export interface SessionPolicyView {
  maxTrustedHours: 0 | 24 | 168 | 720;
  canEdit: boolean;
}
