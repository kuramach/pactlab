import type { Catalog } from '../../lib/i18n/catalog';

/** German guides (machine translation, T-171). */
export const guides: Catalog['guides'] = {
  'saas-acquisition-due-diligence': {
    title: 'Wie führt man die Due Diligence bei einer SaaS-Übernahme durch?',
    description: 'Eine praktische Checkliste für die Due Diligence bei SaaS-Übernahmen: Umsatz, Retention, Verträge, Code und Bewertung – und wie jede Feststellung mit ihrer Evidenz verknüpft bleibt.',
    intro: 'SaaS-Due-Diligence läuft auf eine Frage hinaus: Stützt die Evidenz die Zahl, die Sie gleich bezahlen werden? Arbeiten Sie mit den Quelldaten, nicht mit den Zusammenfassungen, und lassen Sie jede Feststellung ihren Beleg bis in den Preis tragen.',
    sections: [
      {
        heading: '1. Den wiederkehrenden Umsatz aus der Abrechnung neu aufbauen',
        body: 'Der ARR des Managements ist eine Behauptung. Bauen Sie MRR und ARR aus den Rechnungspositionen im Abrechnungsexport neu auf, stimmen Sie dann beides ab und erklären Sie die Differenz.',
        points: [
          'Den letzten Monat aus der Abrechnung annualisieren, nicht aus einem Pipeline- oder Auftragseingangsbericht.',
          'Neugeschäft, Expansion, Kontraktion und Churn je Monat trennen.',
          'Nach Kontraktion suchen, die sich hinter einer stabilen Kundenzahl verbirgt.',
          'Die Kundenkonzentration messen: den Umsatzanteil der größten Kunden.',
        ],
      },
      {
        heading: '2. Die Retention je Kohorte prüfen',
        points: ['Netto- und Brutto-Umsatzretention je Anmeldekohorte, nicht eine einzige gemischte Zahl.', 'Ob sich neuere Kohorten wie ältere verhalten.', 'Welche Kunden die Nettoexpansion treiben.'],
      },
      {
        heading: '3. Die Verträge lesen, die den Preis bewegen',
        points: [
          'Change-of-Control-Klauseln und Kündigungsrechte ohne Grund in den Verträgen der größten Kunden.',
          'Preisüberprüfungs- und Meistbegünstigungsklauseln.',
          'Schulden und schuldenähnliche Posten in der Bilanz.',
        ],
      },
      {
        heading: '4. Den Code und das Team dahinter prüfen',
        body: 'Lesen Sie die Repository-Historie auf Verantwortlichkeiten und Schlüsselpersonenrisiko, Lizenzrisiken und darauf, ob die Lieferung zur Roadmap passt. Die Einzelheiten finden Sie im Leitfaden zur technischen Due Diligence.',
      },
      {
        heading: '5. Ein Aussagenregister führen',
        body: 'Listen Sie auf, was der Verkäufer sagt – ARR, Churn, Personalstand, Runway –, neben dem, was die Evidenz zeigt, und markieren Sie jede Aussage als bestätigt, widerlegt oder unbestätigt. Eine widerlegte Aussage ist meist eine Feststellung.',
      },
      {
        heading: '6. Bepreisen, was Sie finden',
        body: 'Bewerten Sie mit einem ARR-Multiple und einem DCF auf abgestimmten Zahlen. Verknüpfen Sie jede akzeptierte, bepreiste Feststellung als Anpassung mit der Kaufpreisbrücke, damit die Lücke zwischen Angebotspreis und gestütztem Wert Zeile für Zeile erklärt ist.',
      },
      {
        heading: 'So macht es Pactlab',
        body: 'Pactlab importiert den Abrechnungsexport, baut das Umsatzhauptbuch neu auf, liest Repository und Dokumente und entwirft Feststellungen mit Belegen. Eine namentlich benannte prüfende Person akzeptiert oder verwirft jede; akzeptierte Feststellungen fließen in versionierte Bewertungsszenarien und die Kaufpreisbrücke.',
      },
    ],
    related: [{ label: 'Due Diligence für Software und SaaS' }, { label: 'Umsatz und SaaS-Kennzahlen (Englisch)' }, { label: 'Sextant: Bewertung und Deal-Konditionen (Englisch)' }],
  },
  'technical-due-diligence-with-ai': {
    title: 'Wie führt man die technische Due Diligence bei einer Softwareübernahme mit KI durch?',
    description: 'Was technische Due Diligence abdeckt – Verantwortung für den Code, Lizenzen, Lieferfähigkeit und Schlüsselpersonenrisiko – und wie KI die Evidenz lesen kann, während Menschen entscheiden.',
    intro: 'Technische Due Diligence fragt, ob das Produkt nach dem Closing weiterentwickelt werden kann, von wem und mit welchem Risiko. KI hilft, lange Historien schnell zu lesen; die Urteile bleiben bei Menschen.',
    sections: [
      {
        heading: 'Was zu lesen ist',
        points: [
          'Commit-Historie: wer an welchen Teilen des Codes arbeitet und wie sich das verändert hat.',
          'Verantwortlichkeiten: Bereiche mit einer einzigen verantwortlichen Person und Mitwirkende, die gegangen sind.',
          'Abhängigkeiten und Lizenzen: Copyleft- oder unbekannte Lizenzen in ausgeliefertem Code.',
          'Lieferung: Sprint-Zusagen gegenüber Erledigung, Durchlaufzeit und wiedereröffnete Arbeit.',
          'Pull Requests und Reviews: ob Änderungen geprüft werden, bevor sie ausgeliefert werden.',
        ],
      },
      {
        heading: 'Wo KI hilft',
        body: 'Beim Lesen von Tausenden Commits, Tickets und Pull Requests, beim Gruppieren nach Code-Bereich und beim Entwerfen von Feststellungen wie „eine Person verantwortet den Abrechnungsdienst“. Jede entworfene Feststellung muss die Commits oder Tickets zitieren, auf denen sie beruht.',
      },
      {
        heading: 'Wo Menschen entscheiden',
        body: 'Ob eine Abhängigkeit von einer Schlüsselperson zählt, wie ein Bindungsplan aussehen soll und wie ein Risiko bepreist wird. Personendaten verlangen Sorgfalt: standardmäßig Aggregate verwenden, namentliche Ansichten beschränken und Vergütungs- oder Leistungsdaten nie an ein Modell senden.',
      },
      {
        heading: 'Den Quellcode aus der Akte heraushalten',
        body: 'Scannen Sie in einem isolierten, kurzlebigen Arbeitsbereich und behalten Sie nur Feststellungen, Pfade, Hashes und Tool-Versionen. Die Due Diligence braucht keine Kopie des Codes des Zielunternehmens.',
      },
      {
        heading: 'So macht es Pactlab',
        body: 'Pactlab verbindet sich mit GitHub und Jira, liest Metadaten und Historie und zeigt Verantwortlichkeiten, Lieferfähigkeit und Schlüsselpersonenrisiko auf Teamebene. Feststellungen tragen ihre Belege in die Prüfung und, einmal akzeptiert und bepreist, in die Bewertung.',
      },
    ],
    related: [{ label: 'Technologie und Code (Englisch)' }, { label: 'Lieferfähigkeit (Englisch)' }, { label: 'Due Diligence für Software und SaaS' }],
  },
  'prepare-for-vc-due-diligence': {
    title: 'Wie sollten sich Gründer auf die VC-Due-Diligence vorbereiten?',
    description: 'Eine Checkliste für Gründer zur Due Diligence durch Investoren: ARR, Runway, Cap Table, SAFEs und geistiges Eigentum an den eigenen Unterlagen prüfen, bevor ein Investor es tut.',
    intro: 'Investoren prüfen, was Ihre Präsentation sagt, gegen Ihre Unterlagen. Machen Sie dieselbe Prüfung zuerst, beheben Sie, was Sie können, und erklären Sie, was Sie nicht können – bevor es zum Verhandlungspunkt wird.',
    sections: [
      {
        heading: 'Die eigenen Zahlen an den Unterlagen prüfen',
        points: [
          'ARR in der Präsentation gegenüber dem ARR aus Ihrem Abrechnungssystem für den letzten Monat.',
          'Runway in der Präsentation gegenüber der Liquidität geteilt durch den Netto-Burn der letzten drei Monate.',
          'Kundenkonzentration: wie viel Umsatz Ihre größten Kunden ausmachen.',
        ],
      },
      {
        heading: 'Die Cap Table prüfen',
        points: [
          'Ausgegebene Anteile stimmen mit Gründungsurkunde und Board-Beschlüssen überein.',
          'Jeder SAFE und jedes Wandeldarlehen: Cap, Abschlag und Meistbegünstigungsklauseln – eine MFN-Klausel kann einen frühen SAFE zu einem späteren, niedrigeren Cap umwandeln.',
          'Der Optionspool, den der Investor verlangen wird, und ob er aus der Pre-Money-Bewertung kommt.',
        ],
      },
      {
        heading: 'Das Eigentum an dem prüfen, was Sie gebaut haben',
        points: ['Übertragung des geistigen Eigentums in jedem Vertrag mit Gründern, Mitarbeitern und Auftragnehmern.', 'Gründer-Vesting und steuerliche Wahlrechte dokumentiert.'],
      },
      {
        heading: 'Angebote danach vergleichen, was Ihnen bleibt',
        body: 'Modellieren Sie für jedes Term Sheet die Runde: Preis je Anteil, SAFE-Umwandlung, Pool und Gründeranteil nach dem Closing. Die Pre-Money-Schlagzeile ist nicht die ganze Antwort.',
      },
      {
        heading: 'So macht es Pactlab',
        body: 'Venture Raise importiert Ihren Abrechnungsexport, Ihre Cap Table und Ihre monatlichen Finanzzahlen, liest Ihre Dokumente und markiert jede Lücke mit ihrer Quelle. Der Reiter Raise modelliert jedes Angebot nebeneinander, und die Investorenansicht teilt nur die bestätigten Zahlen, die Sie auswählen.',
      },
    ],
    related: [{ label: 'Venture Raise' }, { label: 'Fragen und Antworten für Gründer' }],
  },
};
