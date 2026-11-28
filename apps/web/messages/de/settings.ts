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
  alerts: {
    title: 'Dringende Hinweise auf Telefon und Chat-Apps',
    description:
      'Nur für Punkte, bei denen Sie handeln müssen: eine wartende Unterschrift, Bedingungen zur Antwort, eine Frist in weniger als zwei Tagen, eine Entscheidung des Investitionskomitees, eine Frage an Sie. Jeder Hinweis sagt nur, dass ein Pact Sie braucht, und verlinkt auf Pactlab, das nach der Anmeldung fragt. Er nennt nie den Pact, eine Partei, einen Betrag oder ein Dokument. E-Mails bleiben wie oben eingestellt.',
    limits: 'Höchstens {cap} Hinweise am Tag über alle Kanäle und einer pro Pact alle {fold} Minuten; spätere Ereignisse dieses Pacts kommen gemeinsam im nächsten.',
    channelsLegend: 'Dringende Hinweise senden an',
    notLinked: 'nicht verbunden',
    linkOnProfile: 'Telegram, Slack oder Teams verbinden Sie in Ihrem Profil.',
    profileLink: 'Ihr Profil',
    save: 'Kanäle speichern',
    saved: 'Kanäle gespeichert.',
    invalid: 'Das konnte nicht gespeichert werden. Bitte erneut versuchen.',
    channels: {
      WEB_PUSH: 'Hinweise auf Ihren Geräten',
      TELEGRAM: 'Telegram',
      SLACK: 'Slack',
      TEAMS: 'Microsoft Teams',
      WHATSAPP: 'WhatsApp',
    },
    device: {
      title: 'Hinweise auf diesem Gerät',
      description: 'Pactlab zeigt auf diesem Gerät eine Benachrichtigung, wenn ein Pact Sie braucht, auch wenn der Tab geschlossen ist.',
      iphone: 'Auf iPhone und iPad (iOS 16.4 oder neuer) fügen Sie Pactlab zuerst zum Home-Bildschirm hinzu (Teilen → Zum Home-Bildschirm), öffnen es von dort und schalten die Hinweise ein.',
      turnOn: 'Hinweise auf diesem Gerät einschalten',
      turningOn: 'Wird eingeschaltet…',
      on: 'Hinweise sind auf diesem Gerät eingeschaltet.',
      unsupported: 'Dieser Browser kann keine Pactlab-Hinweise anzeigen. Auf iPhone oder iPad fügen Sie Pactlab zuerst zum Home-Bildschirm hinzu.',
      denied: 'Benachrichtigungen für Pactlab sind in diesem Browser blockiert. Erlauben Sie sie in den Website-Einstellungen und versuchen Sie es erneut.',
      failed: 'Die Hinweise konnten nicht eingeschaltet werden. Es wurde nichts geändert; bitte erneut versuchen.',
      off: 'Hinweise auf Geräten sind für dieses Pactlab noch nicht eingeschaltet.',
      list: 'Ihre Geräte',
      none: 'Noch kein Gerät erhält Hinweise.',
      added: 'Hinzugefügt am {date}',
      test: 'Testhinweis senden',
      tested: 'Testhinweis gesendet.',
      expired: 'Dieses Gerät nimmt keine Hinweise mehr an und wurde entfernt.',
      remove: 'Entfernen',
      removed: 'Gerät entfernt.',
    },
  },
};
