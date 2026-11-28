import type { Localized } from '@pactlab/ui';
import type { Messages } from '../en';
import { common } from './common';
import { findings } from './findings';
import { home } from './home';
import { pact } from './pact';
import { profile } from './profile';
import { settings } from './settings';

/** French (T-173): machine-made, awaiting a native speaker's review (docs/runbooks/app-translations.md). */
export const fr: Localized<Messages> = { common, pact, home, findings, settings, profile };
