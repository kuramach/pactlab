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
  line: {
    title: 'LINE',
    description: 'Kostenlos. Pactlab benachrichtigt Sie auf LINE, wenn ein Pact Sie braucht, ohne Deal-Details, nur mit einem Link. Melden Sie sich mit LINE an und fügen Sie Pactlab dann als Freund hinzu.',
    connected: 'Verbunden',
    verified: 'Bestätigt',
    since: 'seit {date}',
    test: 'Testnachricht senden',
    disconnect: 'LINE trennen',
    disconnectHint: 'Sie können die Verbindung auch in LINE trennen: Senden Sie STOP an Pactlab oder blockieren Sie es.',
    connect: 'LINE verbinden',
    connectHint: 'Öffnet LINE Login. Nach Ihrer Zustimmung bietet LINE an, Pactlab als Freund hinzuzufügen: Nachrichten erreichen Sie erst danach.',
    pendingTitle: 'Noch ein Schritt: Fügen Sie Pactlab auf LINE als Freund hinzu.',
    pendingHint: 'Sobald Sie es hinzufügen, sind Sie verbunden. Wenn Sie den Schritt übersprungen haben, öffnen Sie den Link oder verbinden Sie erneut.',
    addFriend: 'Pactlab auf LINE hinzufügen',
    off: 'LINE ist auf diesem Pactlab noch nicht eingerichtet.',
  },
  lineUsage: {
    summary: 'LINE in diesem Monat ({month}): {sent} von {allowance} kostenlosen Nachrichten gesendet.',
    reached: 'Bis zum nächsten Monat wird nichts mehr gesendet; E-Mails gehen weiterhin.',
    off: 'LINE ist auf diesem Pactlab nicht eingerichtet.',
  },
};
