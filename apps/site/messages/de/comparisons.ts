import type { Catalog } from '../../lib/i18n/catalog';

/**
 * German comparison page (machine translation, T-171). What it says about the other product is a
 * translation of its public product page as checked in October 2026; the source link stays English.
 */
export const comparisons: Catalog['comparisons'] = {
  'valuation-software': {
    title: 'Pactlab im Vergleich mit M&A-Bewertungssoftware',
    description: 'Wie sich Pactlab von Bewertungs- und Deal-Modellierungssoftware wie MoneySoft DealSense unterscheidet: evidenzbasierte Due Diligence mit Feststellungen, die in den Preis fließen.',
    intro: 'Bewertungssoftware modelliert einen Deal aus den Abschlüssen, die Sie eingeben. Pactlab setzt früher an: Es prüft die Evidenz hinter diesen Abschlüssen, erfasst, was es findet, und überträgt die akzeptierten Feststellungen in die Bewertung. Beide beantworten unterschiedliche Fragen, und viele Teams nutzen beide.',
    them: 'MoneySoft DealSense',
    rows: [
      { topic: 'Ausgangspunkt', them: 'Historische Abschlüsse, vom Nutzer eingegeben oder aus Excel oder CSV importiert.', pactlab: 'Quelldaten: Abrechnungsexporte, Code-Repositories, Issue-Tracker, Dokumente und Branchenauszüge.' },
      { topic: 'Due-Diligence-Feststellungen', them: 'Auf der Produktseite nicht beschrieben.', pactlab: 'Entwirft Feststellungen aus der Evidenz, jede mit Beleg; eine namentlich benannte prüfende Person akzeptiert, lehnt ab oder fordert Belege an.' },
      { topic: 'Bewertung', them: 'Unternehmensbewertung, Deal-Preisgestaltung und -Strukturierung, Prognosen, ROI sowie Accretion/Dilution-Analyse.', pactlab: 'Versionierte Szenarien (ARR-Multiple, DCF und Branchenmethoden) mit akzeptierten Feststellungen, verknüpft mit der Kaufpreisbrücke.' },
      { topic: 'Code und Lieferung', them: 'Auf der Produktseite nicht beschrieben.', pactlab: 'Liest Repository-Historie und Issue-Tracker auf Verantwortlichkeiten, Lizenzen und Lieferfähigkeit; bewahrt den Quellcode nie auf.' },
      { topic: 'Vergleichstransaktionen', them: 'Optionale Anbindungen an Datenbanken wie DealStats, BIZCOMPS und RMA Annual Statement Studies.', pactlab: 'Vergleichswerte, mit ihrer Quelle erfasst, neben den evidenzbasierten Szenarien.' },
      { topic: 'Berichte', them: 'Gutachten, Pitchbooks und CIMs, Übernahmeangebote und Term Sheets.', pactlab: 'Feststellungen, das Aussagenregister, Bewertungsszenarien und vorgeschlagene Deal-Konditionen, jeweils bis zur Evidenz nachvollziehbar.' },
      { topic: 'Wo es läuft', them: 'Windows-Desktop oder ein Windows-Remotedesktop, Terminal- oder Citrix-Server.', pactlab: 'Im Browser, jeder Deal durch Row-Level Security in der Datenbank isoliert.' },
    ],
    conclusion: 'Nutzen Sie Bewertungssoftware, um einen Deal aus vereinbarten Finanzzahlen zu modellieren. Nutzen Sie Pactlab, um festzustellen, welche Finanzzahlen die Evidenz stützt, welche Risiken sie zeigt und wie diese Feststellungen den Preis verändern – mit einem Menschen, der jeden Schritt abzeichnet.',
    sources: [{ label: 'MoneySoft: Produktseite von DealSense (Englisch)' }],
  },
};
