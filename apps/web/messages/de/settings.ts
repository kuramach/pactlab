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
    description: 'Für Japan. Pactlab benachrichtigt Sie auf LINE, wenn ein Pact Sie braucht, ohne Einzelheiten zum Deal, nur mit einem Link. Nachrichten kommen auf Englisch und Japanisch.',
    connected: 'Verbunden',
    verified: 'Bestätigt',
    since: 'seit {date}',
    test: 'Testnachricht senden',
    disconnect: 'LINE trennen',
    disconnectHint: 'Sie können auch in LINE selbst trennen: Blockieren Sie das Pactlab-Konto.',
    connect: 'LINE verbinden',
    connectHint: 'Melden Sie sich mit LINE an und fügen Sie dann das Pactlab-Konto als Freund hinzu. Beide Schritte sind nötig; die Anmeldung gilt einmal, 10 Minuten lang.',
    off: 'LINE ist in diesem Pactlab noch nicht eingerichtet.',
    addFriendTitle: 'Noch ein Schritt: Pactlab als Freund hinzufügen',
    addFriendBody: 'LINE stellt Nachrichten nur an Freunde zu. Fügen Sie das Pactlab-Konto innerhalb von 15 Minuten hinzu, dann ist LINE verbunden.',
    addFriend: 'Pactlab auf LINE hinzufügen',
    allowanceNote: 'Pactlab sendet jeden Monat nur eine begrenzte Zahl von LINE-Nachrichten. Ist sie erreicht, bekommen Sie weiterhin die E-Mail.',
    admin: {
      reached: 'LINE-Monatskontingent erreicht',
      reachedBody: 'LINE-Nachrichten werden bis zum nächsten Monat zurückgehalten; die Empfänger haben weiterhin die E-Mail bekommen. Ein kostenpflichtiger LINE-Tarif braucht zuerst Kumars Zustimmung (Runbook: Kontaktkanäle).',
      summary: 'LINE in diesem Monat: {used} von {allowance} Nachrichten verbraucht (Zählung von LINE) · {sent} gesendet · {heldBack} zurückgehalten · {failed} fehlgeschlagen',
      unreadable: 'LINE in diesem Monat: LINE konnte nicht nach dem Verbrauch gefragt werden, daher werden LINE-Nachrichten zurückgehalten · {sent} gesendet · {heldBack} zurückgehalten',
    },
    done: {
      connected: 'LINE ist verbunden.',
    },
    errors: {
      LINE_OFF: 'LINE ist in diesem Pactlab noch nicht eingerichtet.',
      LINE_CANCELLED: 'Die LINE-Anmeldung wurde abgebrochen. Es wurde nichts verbunden.',
      LINE_LOGIN_FAILED: 'Die LINE-Anmeldung wurde nicht abgeschlossen. Versuchen Sie es erneut.',
      LINE_LINK_EXPIRED: 'Diese LINE-Anmeldung ist abgelaufen oder wurde schon verwendet. Beginnen Sie erneut mit „LINE verbinden“.',
      LINE_ALLOWANCE_REACHED: 'Pactlab hat die LINE-Nachrichten dieses Monats verschickt, daher wurde der Test nicht gesendet. Benachrichtigungen bekommen Sie weiterhin per E-Mail.',
    },
  },
};
