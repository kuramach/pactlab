import { common } from './common';
import { findings } from './findings';
import { home } from './home';
import { pact } from './pact';
import { profile } from './profile';
import { settings } from './settings';

/**
 * The English source catalog (T-172). Every user-facing string the app has moved out of its screens lives here;
 * the no-literal check (`lib/i18n/no-literals.test.ts`) keeps new strings from being written inline. A translation
 * is a `Localized<Messages>` overlay, so a renamed or missing key fails typecheck.
 */
export const en = { common, pact, home, findings, settings, profile };
export type Messages = typeof en;
