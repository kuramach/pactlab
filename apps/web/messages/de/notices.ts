import type { Localized } from '@pactlab/ui';
import type { notices as source } from '../en/notices';

export const notices: Localized<typeof source> = {
  demo: {
    label: 'Gemeinsame Demo',
    title: 'Gemeinsame Demo.',
    body: 'Erkunden Sie frei: Jeder Pact und jede Zahl ist synthetisch, und die Demo wird zurückgesetzt, wenn die Freigabe endet. Einladungen, E-Signatur, Abrechnung und das Verbinden externer Systeme sind hier abgeschaltet.',
    blocked: 'Diese Aktion greift außerhalb von Pactlab ein und steht in einer gemeinsamen Demo nicht zur Verfügung.',
  },
  email: {
    label: 'E-Mail-Adresse hinzufügen',
    ask: 'Fügen Sie Ihre E-Mail-Adresse hinzu, damit Pactlab Ihnen sagen kann, wann ein Pact Sie braucht.',
    link: 'E-Mail-Adresse hinzufügen',
  },
  brand: {
    label: 'Pactlab im eigenen Auftritt',
    ask: 'Geben Sie die Website Ihres Unternehmens an, und Pactlab schlägt Logo, Farben und Schrift für Ihr Team und Ihre eigene Anmeldeseite vor. Sie prüfen es zuerst.',
    add: 'Website hinzufügen',
    skip: 'Jetzt nicht',
  },
  featureCards: {
    title: 'Neu',
    titleUnread: 'Neu, {count} ungelesen',
    position: 'Neu · {index} von {total}',
    back: 'Zurück',
    next: 'Weiter',
    dismissLabel: 'Ausblenden: {title}',
    dismissHint: 'Ausblenden. Sie finden es wieder hinter dem Symbol „Neu“.',
    learnMore: 'Mehr erfahren',
  },
};
