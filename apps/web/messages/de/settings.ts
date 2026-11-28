import type { Localized } from '@pactlab/ui';
import type { settings as source } from '../en/settings';

export const settings: Localized<typeof source> = {
  language: {
    title: 'Sprache',
    description: 'Die Sprache, in der Pactlab angezeigt wird. Beträge bleiben in der Währung des jeweiligen Pacts; nur ihre Schreibweise ändert sich.',
    label: 'Sprache',
    save: 'Sprache speichern',
    saved: 'Sprache gespeichert.',
    pilot: 'Auf Deutsch gibt es bisher die Startseite des Pacts und die Befunde; andere Seiten sind noch auf Englisch.',
  },
};
