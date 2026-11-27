import type { Catalog } from '../../lib/i18n/catalog';

/** German FAQ pages (machine translation, T-171). */
export const faqs: Catalog['faqs'] = {
  acquirers: {
    audience: 'Käufer',
    title: 'KI-gestützte Due Diligence für Käufer: Fragen und Antworten',
    description: 'Wie KI-gestützte Due Diligence bei einer Software- oder SaaS-Übernahme funktioniert, was Pactlab prüft und wo weiterhin ein Mensch entscheidet.',
    items: [
      { q: 'Wie funktioniert KI-gestützte Due Diligence bei einer Softwareübernahme?', a: 'Pactlab liest die Evidenz direkt: den Abrechnungsexport, das Code-Repository und seine Historie, den Issue-Tracker und die Dokumente im Datenraum. Es baut den wiederkehrenden Umsatz aus Abrechnungsdaten neu auf, liest Verantwortlichkeiten und Lizenzrisiken aus dem Repository und extrahiert Vertragsbedingungen mit Belegen auf Seitenebene. Die KI entwirft aus dieser Evidenz Feststellungen; eine namentlich benannte prüfende Person akzeptiert, lehnt ab oder fordert Belege an. Berechnungen wie ARR, Retention und Bewertung sind deterministischer Code, keine Modellausgabe.' },
      { q: 'Was prüft Pactlab, das ein Datenraum nicht prüft?', a: 'Ein Datenraum speichert Dokumente. Pactlab prüft, was sie behaupten. Es vergleicht, was das Management berichtet – ARR, Churn, Runway, Personalstand –, mit dem, was Abrechnungsdaten, Repository und Verträge zeigen, und erfasst jeden Vergleich in einem Aussagenregister als bestätigt, widerlegt oder unbestätigt, mit der Quelle beider Seiten.' },
      { q: 'Kann die KI eine Feststellung genehmigen oder den Preis festlegen?', a: 'Nein. Die KI extrahiert, klassifiziert, vergleicht und entwirft. Eine Feststellung gilt erst als akzeptiert, wenn ein Mensch sie akzeptiert, und eine KI-Feststellung ohne auflösbaren Beleg kann überhaupt nicht akzeptiert werden. Preise stammen aus Bewertungsszenarien auf Basis versionierter Annahmen, die ein Mensch genehmigt.' },
      { q: 'Wie verändern Feststellungen die Bewertung?', a: 'Eine akzeptierte, bepreiste Feststellung wird als Anpassung auf der Kaufpreisbrücke mit der Bewertung verknüpft. Ändert sich die Feststellung oder ihre Evidenz, wird jedes davon abhängige Szenario als veraltet markiert, bis es neu gerechnet ist – der Preis beruht also nie stillschweigend auf einer Feststellung, die sich verschoben hat.' },
      { q: 'Bewahrt Pactlab den Quellcode des Zielunternehmens auf?', a: 'Nein. Code wird in einem isolierten, kurzlebigen Arbeitsbereich gelesen, der danach vernichtet wird. Pactlab behält normalisierte Feststellungen, Dateipfade, Hashes und Tool-Versionen – nicht den Quellcode.' },
      { q: 'Wie werden die Personendaten des Zielunternehmens behandelt?', a: 'Menschen erscheinen standardmäßig als Aggregate. Namentliche Ansichten sind zugangsbeschränkt, Lesezugriffe werden protokolliert, kleine Gruppen werden unterdrückt, und HR-, Vergütungs- und namentliche Beitragsdaten werden nie an ein KI-Modell gesendet.' },
      { q: 'Welche Branchen deckt Pactlab ab?', a: 'Software und SaaS sind der Kern. Branchenpakete ergänzen die Quellen, Prüfungen und Bewertungsmethoden für Fintech, Gesundheitsdienstleistungen, Krankenhäuser, kleine Praxen, Telekommunikation und Medien, professionelle Dienstleistungen, Pharma und Biotech, E-Commerce, Mehrfamilienhäuser, Gewerbeimmobilien und Hotels. Jedes Paket behält dieselben Regeln für Prüfung und Belege.' },
    ],
    related: [{ label: 'Leitfaden: Due Diligence bei einer SaaS-Übernahme' }, { label: 'Leitfaden: technische Due Diligence mit KI' }, { label: 'Die Produktmodule (Englisch)' }],
  },
  founders: {
    audience: 'Gründer',
    title: 'Vorbereitung auf die Prüfung durch Investoren: Fragen von Gründern',
    description: 'Wie sich Gründer auf die VC-Due-Diligence vorbereiten, was Investoren in einer Seed-Runde prüfen und wie Venture Raise von Pactlab Ihnen hilft, es zuerst zu sehen.',
    items: [
      { q: 'Wie bereite ich mich auf die VC-Due-Diligence vor?', a: 'Prüfen Sie Ihre eigenen Aussagen an Ihren eigenen Unterlagen, bevor ein Investor es tut. Die üblichen Lücken sind ein ARR in der Präsentation, den die Abrechnung nicht stützt, ein Runway, der auf einer alten Burn Rate beruht, SAFEs, die sich in mehr vom Unternehmen umwandeln als erwartet, und Arbeit von Auftragnehmern ohne Übertragung des geistigen Eigentums. Venture Raise führt diese Prüfungen auf Ihrem Abrechnungsexport, Ihrer Cap Table, Ihren monatlichen Finanzzahlen und Dokumenten durch und zeigt jede Lücke mit ihrer Quelle.' },
      { q: 'Was prüfen Investoren in einer Seed-Runde?', a: 'Typischerweise: Umsatz und seine Qualität, Burn und Runway, die Cap Table und wie ausstehende SAFEs und Wandeldarlehen umgewandelt werden, das Eigentum am geistigen Eigentum, Vesting und steuerliche Wahlrechte der Gründer, wichtige Verträge und die Zusammensetzung des Boards nach der Runde. Die Bereitschafts-Checkliste von Pactlab zeigt, welche dieser Punkte Ihr Datenraum für einen Business Angel und für einen Venture-Fonds bereits beantwortet.' },
      { q: 'Wie vergleiche ich Term Sheets mehrerer Investoren?', a: 'Erfassen Sie jedes Angebot – Pre-Money, Betrag, Pool-Ziel, Liquidationspräferenz, Board-Sitze – im Reiter Raise. Pactlab modelliert die Runde für jedes Angebot, einschließlich SAFE-Umwandlung und Optionspool-Umschichtung, und zeigt Preis je Anteil und Gründeranteil nebeneinander.' },
      { q: 'Was sieht ein Investor, wenn ich meinen Pactlab-Arbeitsbereich teile?', a: 'Nur die Investorenansicht, die Sie teilen wollen: bestätigte Zahlen und die Dokumente, die Sie auswählen. Ihre Feststellungen, Ihre Runway-Analyse und die anderen Angebote bleiben auf Ihrer Seite.' },
      { q: 'Sagt mir Pactlab, was mein Unternehmen wert ist?', a: 'Es modelliert, was jedes Angebot für Ihren Anteil bedeutet, und prüft die Evidenz hinter Ihren Zahlen. Die Bewertung selbst ist das, worauf Sie sich mit Ihren Investoren einigen; Pactlab legt sie nie fest.' },
    ],
    related: [{ label: 'Leitfaden: Vorbereitung auf die VC-Due-Diligence' }, { label: 'Venture Raise' }],
  },
  advisors: {
    audience: 'Deal-Berater',
    title: 'Pactlab für Deal-Berater: Fragen und Antworten',
    description: 'Wie M&A-Berater, Banker und Due-Diligence-Anbieter Pactlab nutzen, um ihre Arbeit zu belegen und jede Zahl nachvollziehbar zu halten.',
    items: [
      { q: 'Wie fügt sich Pactlab in den Due-Diligence-Prozess eines Beraters ein?', a: 'Pactlab ist der Arbeitsbereich, in dem Evidenz, Feststellungen und Bewertung verbunden bleiben. Sie laden den Abrechnungsexport, das Repository, den Issue-Tracker und die Dokumente des Mandanten oder des Zielunternehmens; Pactlab entwirft Feststellungen mit Belegen; Sie prüfen sie; akzeptierte Feststellungen fließen in Bewertungsszenarien und vorgeschlagene Deal-Konditionen.' },
      { q: 'Lässt sich jede Zahl in einem Bericht zurückverfolgen?', a: 'Ja. Jede Zahl führt zu der Evidenz zurück, aus der sie stammt – einer Abrechnungszeile, einem Commit, einer Dokumentseite –, und jede akzeptierte Feststellung hält fest, wer sie wann akzeptiert hat.' },
      { q: 'Werden Mandantendeals getrennt gehalten?', a: 'Ja. Jede Deal-Zeile trägt die Identität ihrer Organisation und ihres Deals, und die Trennung wird in der Datenbank mit Row-Level Security durchgesetzt, nicht nur in der Oberfläche. Mitwirkende des Zielunternehmens sehen nie Feststellungen, Bewertungen oder Verhandlungskonditionen, die nur für den Käufer bestimmt sind, es sei denn, sie werden ausdrücklich geteilt.' },
      { q: 'Welche Bewertungsmethoden stehen zur Verfügung?', a: 'ARR-Multiple und Discounted Cashflow für Software, dazu Paketmethoden, wo die Branche sie braucht: NOI und Cap Rate für Immobilien, kostenträgermix-bereinigtes EBITDA für Krankenhäuser und die Pre-Money-Bewertung der Runde für Gründer, die Kapital aufnehmen. Jedes Szenario speichert seine Annahmen als Version.' },
      { q: 'Können wir unsere eigenen Datenvorlagen nutzen?', a: 'Abrechnungsexporte gängiger Systeme werden per Spaltenzuordnung auf die Standardvorlage von Pactlab abgebildet, und jedes Branchenpaket veröffentlicht eine CSV-Vorlage für seine Auszüge, etwa eine Mieterliste oder einen Kreditbestand.' },
    ],
    related: [{ label: 'So funktioniert es' }, { label: 'Pactlab im Vergleich mit Bewertungssoftware' }, { label: 'Vertrauen und Sicherheit (Englisch)' }],
  },
};
