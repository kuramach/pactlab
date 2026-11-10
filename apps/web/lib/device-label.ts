/**
 * A readable name for the browser and system a person signs in from (T-112), e.g.
 * "Chrome on macOS", shown in Settings so they can tell their devices apart. Only this
 * label is stored; never the raw user agent or an address.
 */
export function deviceLabel(userAgent: string | null | undefined): string | undefined {
  if (!userAgent) return undefined;
  const ua = userAgent.slice(0, 512);
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  const system = /iPhone|iPad|iPod/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X|Macintosh/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  if (!browser && !system) return undefined;
  if (!browser) return `A browser on ${system}`;
  return system ? `${browser} on ${system}` : browser;
}

/** The sign-in page's "Stay signed in on this device" select, shared by the email form and passkeys. */
export const TRUST_FIELD_ID = 'login-trust';

/** "Stay signed in on this device" (T-112): the choices the sign-in page offers. */
export const TRUST_CHOICES = [
  { value: '8h', label: 'No, 8 hours (shared or public computer)' },
  { value: '1d', label: 'Yes, for 1 day' },
  { value: '1w', label: 'Yes, for 1 week' },
  { value: '30d', label: 'Yes, for 30 days' },
] as const;
export type TrustChoice = (typeof TRUST_CHOICES)[number]['value'];

export function trustChoice(value: unknown): TrustChoice {
  return TRUST_CHOICES.find((choice) => choice.value === value)?.value ?? '8h';
}
