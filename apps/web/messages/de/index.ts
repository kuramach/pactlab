import type { Localized } from '@pactlab/ui';
import type { Messages } from '../en';
import { common } from './common';
import { features } from './features';
import { findings } from './findings';
import { home } from './home';
import { pact } from './pact';
import { settings } from './settings';

/** German (T-172 pilot): machine-made, awaiting a native speaker's review (docs/runbooks/app-translations.md). */
export const de: Localized<Messages> = { common, pact, home, findings, settings, features };
