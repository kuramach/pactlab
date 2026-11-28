import type { Catalog } from '../../lib/i18n/catalog';

/** German industry stories: walkthroughs, example findings and FAQs (machine translation, T-171). */
export const stories: Catalog['stories'] = {
  'software-saas': {
    headline: 'Wissen Sie, dass der ARR echt ist, bevor Sie ein Multiple darauf zahlen.',
    subhead:
      'Softwaredeals werden nach wiederkehrendem Umsatz bepreist und nach einer Codebasis, die die meisten Käufer nie lesen. Pactlab prüft beides an der Quelle, und jede Feststellung, die eine prüfende Person akzeptiert, fließt direkt in den Preis.',
    illustrationAlt: 'Illustration eines Anwendungsfensters mit Code, einem steigenden ARR-Diagramm und einem Commit-Graphen.',
    pains: [
      { title: 'ARR, den es nur in der Präsentation gibt', body: 'Der ARR des Managements stimmt selten auf den Cent mit der Abrechnung überein, und in der Lücke versteckt sich das Preisrisiko.' },
      { title: 'Ein Entwickler, der das Produkt trägt', body: 'Interviews beschreiben das Team; die Commit-Historie zeigt, wer tatsächlich was baut.' },
      { title: 'Lizenzen, die mitgeliefert werden', body: 'Copyleft-Komponenten in einem ausgelieferten Produkt können ändern, was Sie kaufen.' },
    ],
    walkthrough: [
      { text: 'Abrechnungsexporte, das Repository und der Delivery-Tracker werden für den Deal angebunden. Jeder Datensatz wird gehasht und mit seiner Quelle aufbewahrt.' },
      { text: 'Der fakturierte ARR bleibt hinter dem Data Book zurück; ein Scanner meldet eine Copyleft-Abhängigkeit; die Commit-Historie zeigt einen einzigen Entwickler hinter dem Abrechnungssystem.' },
      { text: 'Eine prüfende Person akzeptiert die ARR-Lücke mit beigefügter Überleitung und fordert zur Lizenzfeststellung Belege an, bevor sie entscheidet.' },
      { text: 'Die akzeptierten Risiken werden zu bepreisten Anpassungen; das Szenario wird neu gerechnet und zeigt genau, wie und warum sich der Preis bewegt hat.' },
      { text: 'Die ARR-Lücke wird zu einer Kaufpreisanpassung und das Lizenzrisiko zu einer Freistellung, jeweils mit ihrer Evidenz verknüpft.' },
    ],
    findings: [
      { title: 'ARR des Managements übersteigt den fakturierten ARR', evidence: 'Rechnungspositionen, abgestimmt mit der berichteten ARR-Zahl', term: 'Kaufpreisanpassung' },
      { title: 'Copyleft-Komponente im ausgelieferten Agenten', evidence: 'Software-Stückliste zum gescannten Commit', term: 'Spezifische Freistellung und Sanierungsplan' },
      { title: 'Abrechnungssubsystem hängt an einem Mitwirkenden', evidence: 'Commit-Historie, aggregiert nach Subsystem', term: 'Bindungsvereinbarung im Integrationsplan' },
    ],
    deliverables: [
      { title: 'Eine genehmigte ARR-Überleitung', body: 'Von der Präsentation zum Hauptbuch, mit abgezeichneter Differenz.' },
      { title: 'Ein bepreistes Risikoregister', body: 'Jede akzeptierte Feststellung mit ihrer Evidenz, ihrer prüfenden Person und ihrer Preisspanne.' },
      { title: 'Eine eingefrorene Bewertung', body: 'Eingereicht, von einer zweiten Person genehmigt und nie überschrieben.' },
    ],
    faq: [
      { q: 'Bewahrt Pactlab den Quellcode unseres Zielunternehmens auf?', a: 'Nein. Repositories werden in kurzlebigen Arbeitsbereichen gescannt, die danach vernichtet werden. Feststellungen behalten Pfade, Hashes und Tool-Versionen – nie Code.' },
      { q: 'Wer entscheidet, was ein echtes Risiko ist?', a: 'Ihre prüfenden Personen. Analysten, Scanner und Modelle können Feststellungen entwerfen; nur eine namentlich benannte Person kann sie akzeptieren, und nichts erreicht die Bewertung, bevor sie es tut.' },
      { q: 'Was brauchen wir für den Start?', a: 'Einen laufenden Deal, Zugriff auf dessen Abrechnung, Code, Lieferdaten und Dokumente sowie die Personen, die prüfen werden. Das ist ein Pilot.' },
    ],
  },
  fintech: {
    headline: 'Prüfen Sie Volumen und Lizenzen, bevor Sie dafür bezahlen.',
    subhead:
      'Fintech-Deals werden nach Volumen- und Wachstumsangaben bepreist, die in Prozessorexporten liegen, und nach Lizenzen, die still auslaufen können. Pactlab berechnet Volumen, Take Rate und Verlustquoten aus den Exporten neu, prüft die Präsentation daran, liest Status und Ablaufdatum jeder Lizenz und führt die Software-Basis unverändert aus.',
    illustrationAlt: 'Illustration einer Zahlungskarte, eines Bankgebäudes und eines Schilds, verbunden durch einen Transaktionsfluss.',
    pains: [
      { title: 'Eine Volumenangabe, die die Exporte nicht stützen', body: 'Das TPV der Präsentation zählt einen Prozessormonat doppelt, und der Preis wird darauf festgelegt.' },
      { title: 'Eine Lizenz, die still ausgelaufen ist', body: 'Eine bundesstaatliche Lizenz ist vor Monaten abgelaufen, und das Register sagt noch aktiv.' },
      { title: 'Verlustquoten nahe einer Auflage', body: 'Chargebacks steigen über die Schwelle, die die Sponsorbank in die Vereinbarung geschrieben hat.' },
    ],
    walkthrough: [
      { text: 'Prozessorexporte, das Lizenzregister, der Kreditbestand, AML-Warnmeldungen und die GuV je Jahr kommen als Importe; Präsentation, Lizenzen, Sponsorvereinbarung und Compliance-Dokumente werden mit ihrer Quelle gelesen.' },
      { text: 'Deterministische Prüfungen entwerfen widerlegte Aussagen, abgelaufene oder bald ablaufende Lizenzen, Überschreitungen von Verlustschwellen, nicht abgestimmten Umsatz, Kosten, die dem Umsatz davonlaufen, und fehlende Compliance-Nachweise, jeweils mit Beleg.' },
      { text: 'Eine namentlich benannte prüfende Person akzeptiert jede Feststellung, lehnt sie ab oder fordert Belege an; nichts wird von der Software entschieden.' },
      { text: 'ARR-Multiple- und DCF-Szenarien wie bei jedem Softwaredeal, mit akzeptierten Feststellungen auf der Kaufpreisbrücke.' },
      { text: 'Eine abgelaufene Lizenz, bepreist als Treuhandeinbehalt oder Freistellung, oder die Wiedererteilung als Closing-Bedingung; eine Überschreitung bepreist als Einbehalt, jeweils bis zu ihrer Quelle nachvollziehbar.' },
    ],
    findings: [
      { title: 'Das TPV der Präsentation zählt einen Prozessormonat doppelt', evidence: 'Die Zahl der Präsentation gegen die Prozessorexporte', term: 'Ein Abschlag auf das Volumen, das der Preis voraussetzt' },
      { title: 'Bundesstaatliche Lizenz für Geldübermittlung vor vier Monaten abgelaufen', evidence: 'Das angegebene Ablaufdatum der Lizenz gegen das Register', term: 'Wiedererteilung als Closing-Bedingung oder ein Treuhandeinbehalt' },
      { title: 'Chargeback-Quote über der Schwelle der Sponsorvereinbarung', evidence: 'Quartalsquoten aus den Exporten gegen die Klausel', term: 'Ein Reserveeinbehalt' },
      { title: 'Take Rate sinkt fünf Jahre in Folge', evidence: 'Nettoumsatz ÷ Volumen je Jahr aus den Prozessorexporten', term: 'Eine niedrigere Take Rate in den Szenarien, nicht die heutige' },
    ],
    deliverables: [
      { title: 'Volumen und Take Rate, die Sie nachverfolgen können', body: 'TPV, Transaktionen und Take Rate aus den Exporten neu berechnet, mit den Zeilen hinter jeder Zahl.' },
      { title: 'Ein geprüftes Lizenzregister', body: 'Jede Lizenz und Sponsorvereinbarung mit Status und Ablaufdatum, aus Register und Dokumenten.' },
      { title: 'Die GuV über alle Jahre', body: 'Umsatz, Margen sowie Betrugs-, Kredit- und Verarbeitungskosten im Verhältnis zum Umsatz, Jahr für Jahr.' },
    ],
    faq: [
      { q: 'Läuft die Software-Due-Diligence bei einem Fintech-Ziel trotzdem?', a: 'Ja. Fintech-Ziele sind Technologieunternehmen, also laufen Umsatz-, Code-, Liefer-, Sicherheits- und Vertragsprüfung wie bei jedem Softwaredeal. Das Fintech-Paket ergänzt darauf die Prüfungen zu Zahlungen, Lizenzen, Verlustquoten und Compliance.' },
      { q: 'Welche Evidenz liest das Fintech-Paket?', a: 'Abrechnungsexporte von Prozessoren oder Banken, das Lizenz- und Sponsorregister, den Kreditbestand, AML-Warnmeldungen und die GuV je Jahr, dazu Präsentation, Lizenzen, Sponsorvereinbarung und Compliance-Dokumente. Jede Feststellung zitiert die Zeilen oder die Seite, auf der sie beruht.' },
      { q: 'Wie viel Historie liest es?', a: 'Bis zu fünf Jahre GuV und Prozessorexporte, dazu die letzten zwölf Monate. Weniger wird angenommen: Jede Zahl sagt, auf wie vielen Jahren sie beruht, und ein fehlendes Jahr wird beim Verkäufer angefragt, nie geschätzt. Es markiert eine Take Rate, die jedes Jahr sinkt, oder eine Verlustquote, die jedes Jahr steigt.' },
      { q: 'Sagt es mir, ob eine Lizenz erforderlich ist oder ob ein Programm konform ist?', a: 'Nein. Es berichtet Lizenzstatus und Daten so, wie Register und Dokumente sie angeben, und Compliance-Nachweise als vorhanden oder fehlend. Ob eine Lizenz nötig ist und was ein Ablauf bedeutet, beurteilt Ihre Rechtsberatung.' },
      { q: 'Woher kommen die Schwellenwerte?', a: 'Nur aus den Dokumenten selbst, etwa der Überwachungsklausel der Sponsorvereinbarung. Ohne angegebene Schwelle werden die Quoten wie berechnet gezeigt und nichts wird verglichen.' },
    ],
  },
  healthcare: {
    headline: 'Prüfen Sie Einnahmen und Zulassungen, bevor Sie die Praxis kaufen.',
    subhead:
      'Deals mit Leistungserbringern werden nach Einnahmen bepreist, die von Kostenträgerverträgen, dem Ablehnungsverhalten und gültigen Zulassungen der Behandler abhängen. Pactlab berechnet Einnahmen, Ablehnungen und den Kostenträgermix aus den Zahlungsavisen neu, prüft die Präsentation daran, liest die Zulassung jedes Behandlers und prüft Dokumente, Daten und Rechnungen – nie die Qualität der Versorgung.',
    illustrationAlt: 'Illustration eines Praxisgebäudes, einer Herzschlaglinie und einer Abrechnungs-Checkliste.',
    pains: [
      { title: 'Eine Ablehnungsquote, die laut Präsentation sinkt', body: 'Die Zahlungsavise zeigen drei Jahre in Folge steigende Ablehnungen und mit ihnen die Abschreibungen.' },
      { title: 'Eine Zulassung, die still abgelaufen ist', body: 'Das Register sagt aktiv; die Kammer sagt abgelaufen, und der Behandler hat weiter abgerechnet.' },
      { title: 'Ein Behandler, der das Geschäft ist', body: 'Ein Drittel der Einnahmen von einem Behandler, ohne hinterlegtes Wettbewerbsverbot.' },
    ],
    walkthrough: [
      { text: 'Zahlungsavise je Kostenträger, Einnahmen je Behandler, die Personalliste, das Zulassungs- und das Kostenträgervertragsregister und die GuV je Jahr kommen als Importe; Präsentation, Zulassungsnachweise, Wettbewerbsverbotsübersicht, Audits und Verträge werden mit ihrer Quelle gelesen.' },
      { text: 'Deterministische Prüfungen entwerfen widerlegte Aussagen, steigende Ablehnungen, eine Verschiebung im Kostenträgermix, abgelaufene Zulassungen, Behandlerkonzentration, auslaufende Kostenträgerverträge und Kosten, die dem Umsatz davonlaufen, jeweils mit Beleg auf die Zeilen oder die Seite.' },
      { text: 'Eine namentlich benannte prüfende Person akzeptiert jede Feststellung, lehnt sie ab oder fordert Belege an; nichts wird von der Software entschieden.' },
      { text: 'DCF-Szenarien, bei Healthtech mit ARR-Multiple, und akzeptierte Feststellungen auf der Kaufpreisbrücke; Kostenträgermix und Vergütungssätze als Szenario-Sensitivitäten.' },
      { text: 'Eine abgelaufene Zulassung, bepreist als Treuhandeinbehalt oder besondere Freistellung, oder die Wiedererteilung als Closing-Bedingung; ein Bindungseinbehalt für einen Behandler ohne Wettbewerbsverbot; jeweils bis zu ihrer Quelle nachvollziehbar.' },
    ],
    findings: [
      { title: 'Ablehnungsquote steigt drei Jahre in Folge; die Präsentation sagt, sie sei gesunken', evidence: 'Abgelehnte ÷ entschiedene Fälle aus den Zahlungsavisen, gegen die Präsentation', term: 'Ein Abschlag auf die Einnahmen, die der Preis voraussetzt' },
      { title: 'Zwei Behandler rechnen nach Ablauf ihrer Zulassung ab', evidence: 'Das Ablaufdatum im Nachweisdokument gegen Register und Einnahmenexport', term: 'Wiedererteilung als Closing-Bedingung oder ein Treuhandeinbehalt' },
      { title: 'Ein Behandler trägt 31 % der Einnahmen, kein Wettbewerbsverbot hinterlegt', evidence: 'Einnahmen je Behandler gegen die Wettbewerbsverbotsübersicht', term: 'Ein Bindungseinbehalt oder ein Earn-out' },
    ],
    deliverables: [
      { title: 'Einnahmen, die Sie nachverfolgen können', body: 'Einnahmen, Ablehnungen, Forderungslaufzeit und Kostenträgermix je Jahr, mit den Zeilen hinter jeder Zahl.' },
      { title: 'Ein geprüftes Zulassungsregister', body: 'Zulassung und Ablaufdatum jedes Behandlers aus Register und Nachweisdokumenten.' },
      { title: 'Die GuV über alle Jahre', body: 'Umsatz, Margen und Abschreibungen auf Ablehnungen, klinisches Personal, Material und Abrechnungskosten im Verhältnis zum Umsatz, Jahr für Jahr.' },
    ],
    faq: [
      { q: 'Sind dabei Patientendaten im Spiel?', a: 'Nein. Das Paket liest Zahlungsavise auf Kostenträgerebene und Einnahmen auf Behandlerebene über pseudonyme Kennungen – nie einen Patienten, eine Abrechnungsposition oder eine Diagnose. Behandlerdaten bleiben in deterministischem Code und werden nie an ein Modell gesendet.' },
      { q: 'Beurteilt es die Versorgungsqualität oder ob Abrechnung oder Zuweisungen rechtmäßig sind?', a: 'Nein. Es prüft Dokumente, Daten und Rechnungen: Zulassungsstatus und Ablaufdatum so, wie Register und Nachweisdokumente sie angeben, und Compliance-Nachweise als vorhanden oder fehlend. Klinisches und rechtliches Urteil liegen bei Ihren Medizinern und Ihrer Rechtsberatung.' },
      { q: 'Welche Evidenz liest das Gesundheitspaket?', a: 'Zahlungsavise oder Abrechnungsexporte je Kostenträger, Einnahmen je Behandler, die Personalliste, das Zulassungs- und das Kostenträgervertragsregister und die GuV je Jahr, dazu Präsentation, Zulassungsnachweise, die Übersicht zu Wettbewerbsverboten und Bindung, Kodierungsaudits, die HIPAA-Risikoanalyse und Verträge. Jede Feststellung zitiert die Zeilen oder die Seite, auf der sie beruht.' },
      { q: 'Deckt es Healthtech-Softwareziele ab?', a: 'Ja. Bei einem Healthtech-Ziel läuft zusätzlich die Software-Due-Diligence, sodass Umsatz-, Code- und Vertragsfeststellungen neben denen zum Leistungserbringer stehen.' },
    ],
  },
  'telecom-media': {
    headline: 'Abonnementgeschäfte werden nach Angaben bepreist. Prüfen Sie sie an der Abrechnung.',
    subhead:
      'Churn, ARPU und die Verträge, auf denen Inhalte und Distribution beruhen, bestimmen, was ein Telekom- oder Medienunternehmen wert ist. Pactlab liest die Abrechnungsexporte, das Rechteregister, die Abrechnungsberichte und Verträge, die Sie bereitstellen, berechnet die Abonnentenzahlen neu und prüft Präsentation und Daten daran – Dokumente, Daten und Rechnungen, nie ein Urteil über Inhalte oder Markt.',
    illustrationAlt: 'Illustration eines Sendemasts, eines Videoplayers und einer Reihe von Abonnenten.',
    pains: [
      { title: 'Churn, dem die Abrechnung widerspricht', body: 'Die Präsentation sagt 0,9 % im Monat; Kündigungen geteilt durch Abonnenten zu Periodenbeginn im Abrechnungsexport ergeben 1,5 %.' },
      { title: 'Ein Vertrag, der kurz nach dem Closing endet', body: 'Der größte Affiliate-Vertrag läuft nach neun Monaten aus, und das Register sagt 2028.' },
      { title: 'Ein Werbekunde, der die Sparte trägt', body: 'Ein Drittel des Werbeumsatzes kommt von einer Gegenpartei.' },
    ],
    walkthrough: [
      { text: 'Abonnenten je Monat und Abonnentenbewegungen aus dem Abrechnungssystem, das Rechte- und Einspeisungsregister, Werbe- und Affiliate-Umsatz je Gegenpartei, Investitionen und die GuV je Jahr kommen als Importe; KPI-Paket, Investorenpräsentation und Verträge werden mit ihrer Quelle gelesen. Abonnenten erscheinen nur als Anzahl; Fehlendes wird als fehlend gezeigt.' },
      { text: 'Deterministische Prüfungen markieren Abonnenten, Churn und ARPU der Präsentation als bestätigt, widerlegt oder unbestätigt, lesen das Enddatum jedes Vertrags gegen das erwartete Closing, messen Werbe- und Affiliate-Umsatz je Gegenpartei, stellen Content-Kosten je Abonnent und Investitionen dem ARPU je Jahr gegenüber und behalten die Prüfungen berichtet gegen fakturiert sowie nach Region bei, jeweils mit Beleg auf die Zeilen oder die Seite.' },
      { text: 'Eine namentlich benannte prüfende Person akzeptiert jede Feststellung, lehnt sie ab oder fordert Belege an; nichts wird von der Software entschieden.' },
      { text: 'Die Bewertungsmethoden gelten unverändert, mit neu berechnetem Churn und ARPU als Szenario-Eingaben und den Risiken, die die prüfende Person auf der Kaufpreisbrücke bepreist.' },
      { text: 'Eine Verlängerung als Closing-Bedingung, Kaufpreisanpassungen auf Basis des fakturierten Bestands und Konditionen, die mit den Feststellungen verknüpft sind.' },
    ],
    findings: [
      { title: 'Churn von 0,9 % in der Präsentation; 1,5 % im Abrechnungsexport', evidence: 'Kündigungen ÷ Abonnenten zu Periodenbeginn, letzte zwölf Monate', term: 'Der neu berechnete Churn in den Szenarien' },
      { title: 'Der größte Affiliate-Vertrag endet neun Monate nach dem Closing', evidence: 'Das Enddatum im Vertrag selbst gegen das angegebene Closing', term: 'Eine Verlängerung als Closing-Bedingung oder eine Kaufpreisanpassung' },
      { title: 'Ein Werbekunde macht 34 % des Werbeumsatzes aus', evidence: 'Werbeabrechnungen je Gegenpartei', term: 'Gefährdeter Umsatz in den Szenarien' },
      { title: 'Content-Kosten je Abonnent steigen, während der ARPU stagniert', evidence: 'Die GuV je Jahr über die Abonnentenmonate des Abrechnungsexports', term: 'Die Marge des letzten Jahres in den Szenarien' },
    ],
    deliverables: [
      { title: 'Abonnentenzahlen, die Sie vertreten können', body: 'Abonnenten, Churn und ARPU aus den Abrechnungsexporten, gegen das, was die Präsentation sagt.' },
      { title: 'Ein Rechtekalender gegen das Closing', body: 'Das Enddatum und die Verlängerung jedes Vertrags, aus dem Vertrag belegt oder als Angabe des Registers gezeigt.' },
      { title: 'Wer den Umsatz trägt', body: 'Nach Region, nach Werbekunde und nach Distributor, mit den Zeilen hinter jedem Anteil.' },
    ],
    faq: [
      { q: 'Was liest das Paket für Telekommunikation und Medien?', a: 'Abonnenten je Monat und Abonnentenbewegungen aus dem Abrechnungs- oder CRM-System, das Rechte- und Einspeisungsregister, Werbe- und Affiliate-Umsatz je Gegenpartei, Investitionen und die GuV je Jahr sowie KPI-Paket, Investorenpräsentation und Verträge. Es prüft, was bereitgestellt wird, und zeigt Fehlendes als fehlend.' },
      { q: 'Wie werden Churn und ARPU gemessen?', a: 'Churn ist Kündigungen geteilt durch Abonnenten zu Periodenbeginn, ARPU ist Serviceumsatz geteilt durch den Durchschnitt der Abonnenten zu Beginn und Ende, über die letzten zwölf Monate und für jedes Kalenderjahr, das der Export vollständig abdeckt – nie ein hochgerechnetes Teiljahr.' },
      { q: 'Beurteilt Pactlab die Inhalte oder den Markt?', a: 'Nein. Es berichtet, was Exporte und Dokumente angeben, die Daten, die sie nennen, und die Rechnung. Ob eine Gegenpartei verlängert oder ein Programm sein Publikum behält, beurteilen die Menschen, die entscheiden.' },
      { q: 'Wie gelangen die Feststellungen in den Deal?', a: 'Als Szenario-Eingaben und Anpassungen in der Bewertung und als Closing-Bedingungen oder Kaufpreisanpassungen in den Konditionen, jeweils mit ihrer Feststellung verknüpft und von einem Menschen akzeptiert.' },
    ],
  },
  'professional-services': {
    headline: 'Dienstleister werden nach den Menschen bepreist, von denen die Honorare abhängen.',
    subhead:
      'Auslastung, Realisierung und wie viel des Bestands hinausgeht, wenn zwei Partner gehen, bestimmen, was ein Dienstleister wert ist. Pactlab liest die Zeit- und Abrechnungsexporte, Altersstrukturberichte und das Register der Wettbewerbsklauseln, die Sie bereitstellen, berechnet die Ökonomie der Berufsträger neu und prüft sie gegen die Präsentation – Dokumente und Rechnungen, nie eine Beurteilung einer Person.',
    illustrationAlt: 'Illustration einer Aktentasche, eines Auslastungsdiagramms und eines kleinen Teams, aggregiert dargestellt.',
    pains: [
      { title: 'Ein Kunde über der Obergrenze', body: 'Die Präsentation sagt, kein Kunde übersteige 15 % der Honorare; der Abrechnungsexport sagt, der größte liegt bei 27 %.' },
      { title: 'Eine Realisierung, die jedes Jahr nachgibt', body: 'Jede Stunde wird für weniger abgerechnet als im Vorjahr, und ein einzelnes Jahr verdeckt es.' },
      { title: 'Umsatzträger, die frei gehen können', body: 'Für die Partner, die den Bestand tragen, ist kein Abwerbeverbot hinterlegt.' },
    ],
    walkthrough: [
      { text: 'Zeit und Abrechnung je Kunde und Berufsträger, Zeiterfassungen und Personalstand aggregiert, die Altersstrukturberichte zu unfertigen Leistungen und Forderungen und die GuV je Jahr kommen als Importe; das Register der Wettbewerbsklauseln, Kundenverträge und das Memorandum werden mit ihrer Quelle gelesen. Berufsträger erscheinen nur über pseudonyme Kennungen; Fehlendes wird als fehlend gezeigt.' },
      { text: 'Deterministische Prüfungen markieren die Kunden- und Partnerobergrenzen der Präsentation als bestätigt, widerlegt oder unbestätigt, lesen die Realisierung je Jahr und stimmen die Honorare mit der GuV ab, entwerfen einen Umsatzträger ohne hinterlegte Klausel, eine im Working Capital bepreiste Alterungsdrift, eine Auslastung unter dem berichteten Niveau und die Aufteilung in wiederkehrende Honorare, jeweils mit Beleg auf die Zeilen oder die Seite.' },
      { text: 'Eine namentlich benannte prüfende Person akzeptiert jede Feststellung, lehnt sie ab oder fordert Belege an; nichts wird von der Software entschieden, und keine Person wird beurteilt.' },
      { text: 'Die Bewertungsmethoden gelten unverändert, mit Realisierung und Konzentration als Szenario-Eingaben und der Alterungsdrift auf der Kaufpreisbrücke.' },
      { text: 'Unterzeichnete Klauseln als Closing-Bedingung, Bindungseinbehalte oder Earn-outs, die daran geknüpft sind, dass der Bestand bleibt, und Kaufpreisanpassungen, die mit den Feststellungen verknüpft sind.' },
    ],
    findings: [
      { title: 'Der größte Kunde macht 27 % der Honorare aus; die Präsentation sagt, keiner übersteige 15 %', evidence: 'Honorare je Kunde aus dem Abrechnungsexport gegen das Memorandum', term: 'Die neu berechnete Konzentration in den Szenarien' },
      { title: 'Realisierung sinkt über drei Jahre', evidence: 'Honorare gegen den Standardwert, Jahr für Jahr', term: 'Die Realisierung des letzten Jahres in den Szenarien' },
      { title: 'Zwei Umsatzträger ohne hinterlegtes Abwerbeverbot', evidence: 'Partnerbestände gegen das Register der Wettbewerbsklauseln', term: 'Unterzeichnete Klauseln zum Closing oder ein Bindungseinbehalt' },
      { title: 'Unfertige Leistungen über 90 Tage haben sich in einem Jahr verdoppelt', evidence: 'Die Altersstrukturberichte zum Jahresende', term: 'Eine Working-Capital-Kürzung vom Preis' },
    ],
    deliverables: [
      { title: 'Die Ökonomie der Berufsträger aus den Exporten', body: 'Auslastung, Realisierung und Einzug mit den Zeilen dahinter, abgestimmt mit der GuV.' },
      { title: 'Von wem die Honorare abhängen', body: 'Honorare je Kunde und je Partnerbestand, gegen die Obergrenzen, die die Präsentation nennt.' },
      { title: 'Ein Register der Wettbewerbsklauseln, auf das Sie sich verlassen können', body: 'Die Absicherung jedes Umsatzträgers, aus dem Dokument belegt oder als fehlend gezeigt.' },
    ],
    faq: [
      { q: 'Was liest das Dienstleistungspaket?', a: 'Zeit- und Abrechnungsexporte je Monat, Kunde, Mandat und Berufsträger; Zeiterfassungszusammenfassungen und Personalbewegungen aggregiert; Altersstrukturberichte zu unfertigen Leistungen und Forderungen; die GuV je Jahr; sowie das Register der Wettbewerbsklauseln, Kundenverträge und das Informationsmemorandum. Es prüft, was bereitgestellt wird, und zeigt Fehlendes als fehlend.' },
      { q: 'Wie werden Personendaten behandelt?', a: 'Berufsträger erscheinen nur über pseudonyme Kennungen – nie Name, E-Mail oder Vergütung –, und nichts über sie erreicht ein Modell. Das Paket berichtet Dokumente, Abdeckung und Rechnungen; es bewertet oder beurteilt nie eine Person und sagt nie, ob eine Klausel durchsetzbar ist.' },
      { q: 'Wie wird die Realisierung gemessen?', a: 'Abgerechnete Honorare gegen den Standardwert der geleisteten Zeit, für jedes Kalenderjahr, das der Export vollständig abdeckt, nie ein hochgerechnetes Teiljahr. Die Honorare werden Jahr für Jahr mit der importierten GuV abgestimmt.' },
      { q: 'Wie gelangen die Feststellungen in den Deal?', a: 'Als Szenario-Eingaben und Anpassungen in der Bewertung und als Klauseln zum Closing, Bindungseinbehalte, Earn-outs oder Kaufpreisanpassungen in den Konditionen, jeweils mit ihrer Feststellung verknüpft und von einem Menschen akzeptiert.' },
    ],
  },
  'pharma-biotech': {
    headline: 'Pharmadeals werden nach Angaben bepreist. Prüfen Sie sie an den Einreichungen.',
    subhead:
      'Eine Pipeline und ein Patentportfolio tragen den Preis, und die prüfbaren Fehler sind Widersprüche: eine Phase, der der Registereintrag widerspricht, eine Patentklippe, die niemand bepreist hat, ein Meilenstein, der im Modell fehlt. Pactlab liest die Registereinträge, Korrespondenz, Patentunterlagen und Verträge, die Sie bereitstellen, und prüft sie gegen die Angaben des Verkäufers – Dokumente, Daten und Widerspruchsfreiheit, nie ein Urteil über die Wissenschaft.',
    illustrationAlt: 'Illustration einer DNA-Helix, einer Kapsel und eines Patentdokuments mit einem Kalender.',
    pains: [
      { title: 'Eine Phase, die die Einreichungen nicht stützen', body: 'Die Präsentation sagt Phase 2; der bereitgestellte Registereintrag sagt Phase 1.' },
      { title: 'Eine Patentklippe innerhalb der Haltedauer', body: 'Das Schlüsselpatent läuft eineinhalb Jahre nach dem Closing aus, und der Preis geht davon aus, dass es das nicht tut.' },
      { title: 'Ein Meilenstein, der im Modell fehlt', body: 'Der Lizenzvertrag schuldet eine Zahlung beim nächsten Phasenstart; das Modell des Verkäufers enthält sie nicht.' },
    ],
    walkthrough: [
      { text: 'Die Pipeline-Übersicht, die Studienregistereinträge, die Patentübersicht, das Verpflichtungsmodell, die F&E-Personalliste und die GuV je Jahr kommen als Importe; regulatorische Korrespondenz, Patentunterlagen, Lizenz- und Lieferverträge und die Präsentation werden mit ihrer Quelle gelesen.' },
      { text: 'Deterministische Prüfungen markieren jede Angabe zu Phase, Status und Ergebnisdatum als bestätigt, widerlegt oder unbestätigt, entwerfen eine Patentklippe innerhalb der Haltedauer, eine im Modell fehlende oder zu niedrig angesetzte Verpflichtung, Fertigung aus einer einzigen Quelle, Konzentration auf Schlüsselwissenschaftler und stagnierende F&E bei vorgezogenem Zeitplan, jeweils mit Beleg auf die Zeilen oder die Seite.' },
      { text: 'Eine namentlich benannte prüfende Person akzeptiert jede Feststellung, lehnt sie ab oder fordert Belege an; nichts wird von der Software entschieden, und nichts beurteilt Wirksamkeit, Zulassungsfähigkeit oder Studiendesign.' },
      { text: 'DCF-Szenarien mit akzeptierten Feststellungen auf der Kaufpreisbrücke: die Patentklippe auf den Umsatz des Produkts bepreist, der fehlende Meilenstein in der Höhe, die der Vertrag nennt.' },
      { text: 'Meilensteine und bedingte Zahlungen, eine Klausel zur Liefersicherheit oder eine Bindungsvereinbarung, jeweils bis zu ihrer Quelle nachvollziehbar.' },
    ],
    findings: [
      { title: 'Für den Hauptwirkstoff wird Phase 2 angegeben; der Registereintrag sagt Phase 1', evidence: 'Die Pipeline-Übersicht gegen den Studienregistereintrag und das Protokoll der Behörde', term: 'Ein späteres, langsameres Szenario' },
      { title: 'Das Schlüsselpatent läuft 18 Monate nach dem Closing aus', evidence: 'Das Ablaufdatum in der Patentunterlage gegen Closing-Datum und Haltedauer', term: 'Eine Kaufpreisminderung auf den gefährdeten Umsatz' },
      { title: 'Ein Meilenstein beim nächsten Phasenstart fehlt im Modell des Verkäufers', evidence: 'Die Klausel des Lizenzvertrags gegen das Verpflichtungsmodell', term: 'Der Meilenstein vom Preis abgezogen oder eine vom Verkäufer getragene Zahlung' },
      { title: 'F&E-Ausgaben stagnieren, während der Zeitplan vorgezogen wird', evidence: 'F&E über alle importierten GuV-Jahre gegen die neuen Daten der Präsentation', term: 'Die späteren Daten oder die zusätzliche F&E in den Szenarien' },
    ],
    deliverables: [
      { title: 'Ein Register der Pipeline-Angaben', body: 'Jede angegebene Phase und jedes Ergebnisdatum, bestätigt, widerlegt oder unbestätigt, mit der Einreichung dahinter.' },
      { title: 'Das Patentportfolio gegen die Haltedauer', body: 'Die erste Patentklippe jedes Produkts, die Unterlage, die sie datiert, und der Umsatz dahinter.' },
      { title: 'Verpflichtungen, die das Modell enthalten muss', body: 'Jeder Meilenstein, jede Lizenzgebühr und jedes Entgelt, die die Verträge nennen, und ob das Modell des Verkäufers sie enthält.' },
    ],
    faq: [
      { q: 'Welche Evidenz liest das Paket?', a: 'Die Pipeline-Übersicht, die Studienregistereinträge, die der Verkäufer bereitstellt, die Patentübersicht und Patentunterlagen, die Lizenz- und Lieferverträge, das Modell des Verkäufers zu seinen Verpflichtungen, eine F&E-Personalliste über pseudonyme Kennungen, regulatorische Korrespondenz und die GuV je Jahr. Pactlab schlägt selbst nicht in Registern nach; es prüft, was bereitgestellt wird.' },
      { q: 'Beurteilt es die Wissenschaft oder die Zulassungschance?', a: 'Nein. Es prüft Dokumente, Daten und Widerspruchsfreiheit: eine angegebene Phase gegen die Einreichung, ein Ablaufdatum gegen die Haltedauer, eine Zahlung gegen den Vertrag. Wirksamkeit, Zulassungsfähigkeit und Studiendesign beurteilen Ihre wissenschaftlichen und regulatorischen Berater.' },
      { q: 'Wie werden Patentklippen und Verpflichtungen bepreist?', a: 'Eine Klippe innerhalb der Haltedauer wird auf den fakturierten Umsatz des geschützten Produkts bepreist: niedrig ein Jahr davon, hoch ein Jahr für jedes verbleibende Jahr der Haltedauer, vor der Erosion, die Ihre prüfende Person festlegt. Ein fehlender Meilenstein wird in der Höhe bepreist, die der Vertrag nennt. Ein Mensch akzeptiert jeden Preis.' },
      { q: 'Wie werden Personendaten behandelt?', a: 'Wissenschaftler erscheinen nur als pseudonyme Kennungen und Anzahlen; ihre Zahlen bleiben in deterministischem Code und werden nie an ein Modell gesendet. HR-Dokumente werden von den Prüfungen nie gelesen.' },
    ],
  },
  'ecommerce-dtc': {
    headline: 'Marken werden nach Lifetime Value bepreist. Berechnen Sie ihn auf Deckungsbeitragsbasis neu.',
    subhead:
      'DTC-Deals werden nach LTV-Angaben bepreist und nach Umsatz, der über Konten laufen kann, die dem Verkäufer persönlich gehören. Pactlab liest die Shop-, Marktplatz- und Werbeplattformexporte und die Kontounterlagen, die Sie bereitstellen, berechnet die Stückökonomie auf Deckungsbeitragsbasis neu und prüft sie gegen die Präsentation – nur Exporte und Dokumente, nie Scraping.',
    illustrationAlt: 'Illustration eines Ladengeschäfts, einer Einkaufstasche mit Wiederholungspfeil und Wiederkäufen je Kohorte.',
    pains: [
      { title: 'Ein Lifetime Value auf Bruttoumsatz', body: 'Der LTV der Präsentation zählt den Bruttoumsatz; auf Deckungsbeitragsbasis, nach Warenkosten, Fulfilment und Gebühren, ist er ein Bruchteil davon.' },
      { title: 'Das Marktplatzkonto gehört dem Gründer', body: 'Der Großteil des Umsatzes läuft über ein Verkäuferkonto, das auf den Gründer persönlich registriert ist, nicht auf das Unternehmen.' },
      { title: 'Lagerbestand, der sich nicht verkauft', body: 'Ein Fünftel des Lagerwerts ist vor mehr als sechs Monaten eingegangen.' },
    ],
    walkthrough: [
      { text: 'Bestellungen je Kanal und Konto, Kohorten, Werbeausgaben, der Lagerbericht und die GuV je Jahr kommen als Importe; die Kontounterlagen der Plattformen, Marktplatzbedingungen und die Investorenpräsentation werden mit ihrer Quelle gelesen. Ein fehlender Export wird als fehlend gezeigt.' },
      { text: 'Deterministische Prüfungen markieren LTV und CAC der Präsentation als bestätigt, widerlegt oder unbestätigt, stimmen den Kanalumsatz je Jahr mit der GuV ab, entwerfen ein wesentliches, persönlich gehaltenes Konto, als Abschreibung bepreisten Altbestand, eine steigende Retourenquote sowie über die Jahre steigende Akquisitionskosten bei schrumpfendem Deckungsbeitrag, jeweils mit Beleg auf die Zeilen oder die Seite.' },
      { text: 'Eine namentlich benannte prüfende Person akzeptiert jede Feststellung, lehnt sie ab oder fordert Belege an; nichts wird von der Software entschieden.' },
      { text: 'Die Bewertungsmethoden gelten unverändert, mit der Stückökonomie auf Deckungsbeitragsbasis als Szenario-Eingaben und der Abschreibung auf Altbestand auf der Kaufpreisbrücke.' },
      { text: 'Die Übertragung des Kontos auf das Unternehmen als Closing-Bedingung, ein Treuhandeinbehalt bis zur Erledigung und Kaufpreisanpassungen, die mit der Stückökonomie verknüpft sind.' },
    ],
    findings: [
      { title: 'Der Lifetime Value der Präsentation ist auf Bruttoumsatz berechnet', evidence: 'Die Präsentation gegen Kohorten, Bestellungen und Deckungsbeitrag aus den Exporten', term: 'Der LTV auf Deckungsbeitragsbasis in den Szenarien' },
      { title: '64 % des Umsatzes laufen über ein Marktplatzkonto, das der Gründer persönlich hält', evidence: 'Bestellungen je Konto gegen die Kontounterlagen der Plattform', term: 'Übertragung als Closing-Bedingung, ein Treuhandeinbehalt bis zur Erledigung' },
      { title: '22 % des Lagerbestands sind älter als 180 Tage', evidence: 'Der Lagerbericht, gealtert bis zu seinem Stichtag', term: 'Eine Abschreibung vom Preis' },
      { title: 'Akquisitionskosten steigen und Deckungsbeitrag schrumpft über drei Jahre', evidence: 'Bestellungen je Jahr gegen die Werbung in jedem importierten GuV-Jahr', term: 'Die Stückökonomie des letzten Jahres in den Szenarien' },
    ],
    deliverables: [
      { title: 'Stückökonomie aus den Exporten', body: 'Lifetime Value auf Deckungsbeitragsbasis und bezahlte Akquisitionskosten, mit den Zeilen dahinter.' },
      { title: 'Plattformabhängigkeit', body: 'Der Umsatzanteil jedes Kontos und auf wen es registriert ist, aus der Unterlage belegt.' },
      { title: 'Kanalumsatz, der aufgeht', body: 'Nettoumsatz je Kanal, Jahr für Jahr mit der GuV abgestimmt.' },
    ],
    faq: [
      { q: 'Was liest das E-Commerce-Paket?', a: 'Shop- und Marktplatz-Bestellexporte je Monat, Kanal und Konto, Wiederkäufe je Kohorte, Ausgabenexporte der Werbeplattformen, den Lagerbericht, die GuV je Jahr sowie die Kontounterlagen der Plattformen, Marktplatzbedingungen und die Investorenpräsentation. Pactlab meldet sich nie bei einem Marktplatz, Shop oder einer Werbeplattform an und scrapt sie nie; es prüft, was bereitgestellt wird, und zeigt Fehlendes als fehlend.' },
      { q: 'Wie wird der Lifetime Value neu berechnet?', a: 'Bestellungen je Kunde in den ersten zwölf Monaten kommen aus den Kohorten; der Deckungsbeitrag je Bestellung kommt aus den Endkundenbestellungen, nach Rabatten, Retouren, Warenkosten, Fulfilment und Kanalgebühren. Das Produkt wird der Zahl der Präsentation gegenübergestellt; entspricht die Präsentation denselben Bestellungen zum Bruttoumsatz, sagt die Feststellung das.' },
      { q: 'Ändert es, wie die Marke bewertet wird?', a: 'Nein. Die Bewertungsmethoden sind dieselben; Feststellungen zur Stückökonomie fließen als Eingaben und Anpassungen ein, und Altbestand wird als Abschreibung bepreist, die ein Mensch akzeptiert.' },
      { q: 'Was passiert, wenn ein Konto persönlich gehalten wird?', a: 'Ein Shop-, Marktplatz- oder Werbekonto, das einen wesentlichen Anteil des Umsatzes trägt und auf eine Einzelperson registriert ist, wird zur Prüfung entworfen, mit seinem Anteil und dem Satz aus der Unterlage. Seine Übertragung auf das Unternehmen ist eine Closing-Bedingung, die die prüfende Person als Treuhandeinbehalt bepreisen kann.' },
    ],
  },
  multifamily: {
    headline: 'Zahlen Sie für die Mieterliste, nicht für das Angebotsmemorandum.',
    subhead:
      'Der Wert eines Mehrfamilienhauses ist das Nettobetriebsergebnis geteilt durch eine Cap Rate. Pactlab baut die Erträge aus der Mieterliste und der T-12 neu auf, prüft den Zustand der Wohnungen und bepreist, was es findet.',
    illustrationAlt: 'Illustration eines Wohngebäudes, einer Mieterliste und eines Diagramms des Nettobetriebsergebnisses.',
    pains: [
      { title: 'Erträge, die es nur im Memorandum gibt', body: 'Pro-forma-Mieten und Bestandsmieten sind unterschiedliche Zahlen, und der Preis wird auf eine davon festgelegt.' },
      { title: 'Aufgeschobene Instandhaltung hinter jeder Tür', body: 'Die Begehungen der Wohnungen erzählen eine andere Geschichte als die Fotos.' },
      { title: 'Zahlungsrückstände in wenigen Gebäuden', body: 'Eine gemischte Einzugsquote kann verbergen, wo die Rückstände wirklich liegen.' },
    ],
    walkthrough: [
      { text: 'Mieterliste, T-12, bis zu fünf Jahre Erträge, Kosten, Mieten und Belegung, Mietvertragsakten, Rückstandsberichte, Versorgerrechnungen und Wohnungsbegehungen werden für den Deal angebunden und mit ihrer Quelle aufbewahrt.' },
      { text: 'Mietdifferenz zum Markt, aufgeschobene Instandhaltung je Einheit, die Konzentration der Rückstände, sinkende Belegung, Kosten, die schneller wachsen als die Mieten, und ein Sprung des NOI im letzten Jahr werden mit den Zeilen und Begehungen dahinter entworfen.' },
      { text: 'Eine prüfende Person akzeptiert die Instandhaltungsfeststellung mit ihrer Kostenspanne und fordert zur Entwicklung der Rückstände Belege an.' },
      { text: 'Nettobetriebsergebnis und Cap Rate laufen in der Szenario-Engine; Investitionen je Einheit landen als Sanierung.' },
      { text: 'Aufgeschobene Instandhaltung wird zu einer Kaufpreisanpassung oder einem Reparatur-Treuhandeinbehalt. Potenzial aus der Mietdifferenz wird als bestätigter Wert erfasst, nie auf den Preis aufgeschlagen.' },
    ],
    findings: [
      { title: 'Aufgeschobene Instandhaltung über dem Investitionsbudget', evidence: 'Zustandsbegehungen der Wohnungen gegen den Investitionsplan', term: 'Reparatur-Treuhandeinbehalt oder Kaufpreisanpassung' },
      { title: 'Zahlungsrückstände in einem Gebäude konzentriert', evidence: 'Rückstandsberichte, abgestimmt mit der Mieterliste', term: 'Auflage zum Forderungseinzug und Abwärtsszenario' },
      { title: 'Bestandsmieten in der ganzen Anlage unter dem Markt', evidence: 'Mieterliste gegen die aktuellen Mietvertragsakten', term: 'Bestätigter Wert im Hauptbuch, kein gezahlter Preis' },
      { title: 'Belegung sinkt über drei Jahre', evidence: 'Fünf Jahre Belegung nach Monat', term: 'Ein Abschlag auf die in den Szenarien angenommene Belegung' },
      { title: 'Ein NOI-Sprung im letzten Jahr', evidence: 'Fünf Jahre Betriebsabrechnungen', term: 'Einmaleffekte und aufgeschobene Reparaturen prüfen, bevor auf dem letzten Jahr bepreist wird' },
    ],
    deliverables: [
      { title: 'Eine Ertragsüberleitung', body: 'Vom Memorandum zur Mieterliste, mit abgezeichneter Differenz.' },
      { title: 'Ein Investitionsregister je Einheit', body: 'Jede akzeptierte Instandhaltungsfeststellung mit ihrer Evidenz und Kostenspanne.' },
      { title: 'Szenarien nach NOI und Cap Rate', body: 'Aus gespeicherten Eingaben gerechnet, damit jede Preisänderung nachvollziehbar ist.' },
    ],
    faq: [
      { q: 'Was liest das Mehrfamilienhaus-Paket?', a: 'Die Mieterliste und die T-12, Mietvertragsakten, Rückstandsberichte, Versorgerrechnungen und Zustandsbegehungen der Wohnungen. Die Mieterliste lässt sich auf dasselbe Umsatzhauptbuch abbilden, das Pactlab für wiederkehrenden Umsatz nutzt.' },
      { q: 'Wie viel Historie liest es?', a: 'Bis zu fünf Jahre Erträge, Kosten, Mieten und Belegung, dazu die T-12. Weniger wird angenommen: Jede Zahl sagt, auf wie vielen Jahren sie beruht, und ein fehlendes Jahr wird beim Verkäufer angefragt, nie geschätzt. Es markiert sinkende Belegung, Kosten, die schneller wachsen als die Mieten, und einen Sprung des NOI im letzten Jahr.' },
      { q: 'Erhöht die Mietdifferenz den Preis, den wir zahlen?', a: 'Nein. Potenzial aus Mieten unter Marktniveau wird als bestätigter Wert erfasst – als Evidenz, die den Preis stützt – und nie als Grund, mehr zu zahlen.' },
      { q: 'Wie werden Investitionen behandelt?', a: 'Aufgeschobene Instandhaltung je Einheit ist eine bepreiste Feststellung. Sobald eine prüfende Person sie akzeptiert, wird sie zur Sanierung in der Bewertung und zu einer Kaufpreisanpassung oder einem Treuhandeinbehalt in den Konditionen.' },
    ],
  },
  'commercial-property': {
    headline: 'Ein Gebäude ist so viel wert wie die Mietverträge darin.',
    subhead:
      'Büro-, Einzelhandels- und Industrieobjekte werden nach Mieterträgen und deren Dauer bepreist. Pactlab erstellt Mietvertragsauszüge mit exakten Belegen, bildet den Auslauf ab und markiert, was die Umwelt- und Bauplanungshistorie enthält.',
    illustrationAlt: 'Illustration eines Geschäftsgebäudes, einer Zeitachse der auslaufenden Mietverträge und eines Umweltgutachtens.',
    pains: [
      { title: 'Zwei Mieter, der Großteil der Erträge', body: 'Die Mieterkonzentration entscheidet, wie dauerhaft die Erträge sind.' },
      { title: 'Mietverträge, die innerhalb der Haltedauer enden', body: 'Eine starke WALT auf dem Papier kann eine Wand kurzfristiger Abläufe verbergen.' },
      { title: 'Ein Umweltgutachten, das niemand genau gelesen hat', body: 'Feststellungen aus Phase I und bauplanerische Grenzen gehen mit dem Objekt über.' },
    ],
    walkthrough: [
      { text: 'Mietvertragsauszüge, die Mieterliste, Nebenkostenabrechnungen, Phase-I-Umweltgutachten und Bauplanungsunterlagen.' },
      { text: 'Mieterkonzentration, kurzfristiger Auslauf gegen die WALT, Mietverträge über und unter Markt und Umwelthinweise, jeweils mit ihrer Klausel oder ihrem Gutachten belegt.' },
      { text: 'Prüfende Personen entscheiden jede Feststellung mit der Mietvertragsklausel oder der Gutachtenseite vor Augen.' },
      { text: 'WALT und Auslaufplan sind Szenario-Eingaben, die Cap-Rate-Sensitivität wird deterministisch gerechnet.' },
      { text: 'Kaufpreisanpassungen, Vermietungsreserven und Umweltfreistellungen, verknüpft mit den Feststellungen.' },
    ],
    findings: [
      { title: 'Mietvertrag des Ankermieters endet innerhalb der Haltedauer', evidence: 'Ablauf- und Verlängerungsklauseln aus dem Mietvertrag zitiert', term: 'Vermietungsreserve und Abwärtsszenario' },
      { title: 'Erkannte Umweltbelastung im Phase-I-Gutachten', evidence: 'Phase-I-Umweltgutachten zum Standort, seitengenau zitiert', term: 'Umweltfreistellung oder Treuhandeinbehalt' },
      { title: 'Nebenkostenumlagen unter den Kosten', evidence: 'Nebenkostenabrechnungen gegen die Betriebsrechnung', term: 'Ertragsanpassung in der Bewertung' },
    ],
    deliverables: [
      { title: 'Belegte Mietvertragsauszüge', body: 'Jede wichtige Bedingung mit der Klausel verknüpft, aus der sie stammt.' },
      { title: 'Ein Auslaufplan', body: 'Abläufe gegen die WALT, in der Bewertung statt in einem Anhang.' },
      { title: 'Cap-Rate-Sensitivität', body: 'Was eine Änderung der Cap Rate mit dem Preis macht, aus gespeicherten Eingaben.' },
    ],
    faq: [
      { q: 'Welche Objektarten deckt das Paket ab?', a: 'Büro-, Einzelhandels- und Industrieobjekte, einzelne Gebäude und Portfolios.' },
      { q: 'Wie werden Mietverträge ausgewertet?', a: 'Modelle entwerfen den Auszug mit exakten Belegen auf den Mietvertrag; eine Klausel, die sich nicht finden lässt, wird verworfen, und eine namentlich benannte prüfende Person akzeptiert jede Bedingung.' },
      { q: 'Wie gelangen Umweltfeststellungen in den Deal?', a: 'Eine akzeptierte Feststellung aus Phase I oder Bauplanung wird zu einem bepreisten Risiko – einer Freistellung, einem Treuhandeinbehalt oder einer Kaufpreisanpassung –, verknüpft mit der Seite, von der sie stammt.' },
    ],
  },
  hotels: {
    headline: 'Ein Hotel ist ein Betrieb auf einer Immobilie.',
    subhead:
      'Logisumsatz, Markenpflichten und die Investitionen, die die Marke verlangen wird, bestimmen, was ein Hotel wert ist. Pactlab liest die Betriebshistorie und die Verträge und bepreist den Modernisierungsplan, bevor Sie unterschreiben.',
    illustrationAlt: 'Illustration eines Hotelgebäudes, eines RevPAR-Diagramms und eines Markenvertrags.',
    pains: [
      { title: 'RevPAR ohne Wettbewerbsumfeld gelesen', body: 'Wachstum, das hinter dem Markt zurückbleibt, ist verkleideter Rückgang.' },
      { title: 'Ein Renovierungsplan der Marke, der beim Closing wartet', body: 'Modernisierungspläne können am Tag des Closings beim Käufer landen.' },
      { title: 'Nachfrage, die in einer Saison lebt', body: 'Ein starkes Jahr kann auf wenigen Monaten oder einer einzigen Nachfragequelle beruhen.' },
    ],
    walkthrough: [
      { text: 'PMS- und STR-Berichte, Franchise- und Markenverträge, Managementverträge, die Historie von Belegung, ADR und RevPAR sowie GuVs der Gastronomie.' },
      { text: 'Aufgeschobene PIP-Investitionen, Franchisebelastungen und Kündigungsfenster sowie Saisonalität der Nachfrage, jeweils mit ihrer Quelle belegt.' },
      { text: 'Prüfende Personen entscheiden jede Feststellung mit der Vertragsklausel oder den Betriebszeilen vor Augen.' },
      { text: 'RevPAR- und GOP-Margentrends fließen in die Szenarien; PIP-Investitionen landen als Sanierung.' },
      { text: 'PIP-Investitionen als Kaufpreisanpassung oder Treuhandeinbehalt und Zustimmungen der Marke als Closing-Bedingungen.' },
    ],
    findings: [
      { title: 'Marken-PIP bei Eigentümerwechsel erforderlich', evidence: 'Klausel aus dem Franchisevertrag zitiert', term: 'Kaufpreisanpassung oder PIP-Treuhandeinbehalt' },
      { title: 'RevPAR-Wachstum bleibt hinter dem Wettbewerbsumfeld zurück', evidence: 'STR-Berichte gegen die Betriebshistorie', term: 'Abwärtsszenario in der Bewertung' },
      { title: 'Managementvertrag nur gegen Gebühr kündbar', evidence: 'Kündigungsklausel aus dem Managementvertrag zitiert', term: 'Kündigungskosten in der Kaufpreisbrücke' },
    ],
    deliverables: [
      { title: 'RevPAR- und Margentrends', body: 'Aus der Betriebshistorie, dem Wettbewerbsumfeld gegenübergestellt.' },
      { title: 'Ein Register der Markenpflichten', body: 'PIP, Belastungen und Kündigungsfenster, jeweils mit ihrer Klausel.' },
      { title: 'Konditionen, die die Investitionen tragen', body: 'PIP-Kosten in den Deal eingepreist, statt danach entdeckt.' },
    ],
    faq: [
      { q: 'Was liest das Hotelpaket?', a: 'PMS- und STR-Berichte, Franchise- und Markenverträge, Managementverträge, die Historie von Belegung, ADR und RevPAR sowie GuVs der Gastronomie.' },
      { q: 'Wie wird der Modernisierungsplan bepreist?', a: 'Als bepreiste Feststellung. Einmal akzeptiert, sind PIP-Investitionen eine Sanierung in der Bewertung und eine Kaufpreisanpassung oder ein Treuhandeinbehalt in den Konditionen.' },
      { q: 'Deckt es Privathotels ab?', a: 'Ja. Ohne Marke gibt es keine Franchisefeststellungen; Feststellungen zu Betrieb, Nachfrage und Managementvertrag gelten weiterhin.' },
    ],
  },
  'venture-raise': {
    headline: 'Gehen Sie in die Due Diligence und wissen Sie, was der Investor finden wird.',
    subhead:
      'Investoren prüfen die Präsentation gegen die Abrechnung, die Cap Table gegen die Gesellschaftsunterlagen und das geistige Eigentum gegen die Verträge. Venture Raise führt dieselben Prüfungen zuerst für den Gründer durch, modelliert jedes konkurrierende Angebot und behält, was Sie finden, auf Ihrer Seite, bis Sie es teilen wollen.',
    illustrationAlt: 'Illustration einer Kennzahl aus der Präsentation, geprüft gegen die Abrechnung, einer Cap Table und zweier Term Sheets nebeneinander.',
    pains: [
      { title: 'Eine Zahl in der Präsentation, die die Abrechnung nicht stützt', body: 'Eine Schlüsselkennzahl, der die erste Prüfung des Investors widerspricht, kostet mehr Glaubwürdigkeit als jede andere Feststellung.' },
      { title: 'SAFEs, die sich in mehr umwandeln, als Sie denken', body: 'Caps, Abschläge und eine vergessene MFN-Klausel entscheiden, wie viel des Unternehmens die Runde wirklich nimmt.' },
      { title: 'Geistiges Eigentum, das noch einem Auftragnehmer gehört', body: 'Ein einziger Vertrag ohne Rechteübertragung wird zur Closing-Bedingung.' },
    ],
    walkthrough: [
      { text: 'Abrechnung, Cap Table, monatliche Liquidität und Burn, die Gesellschaftsunterlagen, Auftragnehmerverträge, das SAFE-Register und die Term Sheets, die Sie erhalten haben.' },
      { text: 'Der ARR der Präsentation wird gegen die Abrechnung geprüft und ihr Runway gegen die Liquidität; SAFEs, Pool und Rechtekette am geistigen Eigentum werden gegen die Dokumente geprüft. Jede Zahl der Präsentation wird zu einer Aussage: bestätigt, widerlegt oder unbestätigt.' },
      { text: 'Sie entscheiden, was jede Feststellung bedeutet, und beheben, was Sie können, bevor ein Investor es sieht. Stärken bleiben vertraulich, bis Sie sie zeigen wollen.' },
      { text: 'Jedes Angebot läuft durch das Rundenmodell: Preis je Anteil, SAFE-Umwandlung zum Cap oder mit Abschlag, die Pool-Umschichtung in Anteilen und Prozent und der Anteil der Gründer nach der Runde.' },
      { text: 'Liquidationspräferenz und Zusammensetzung des Boards werden in klaren Worten erklärt. Pactlab zeigt, was eine Kondition bewirkt; die Entscheidung bleibt bei Ihnen und Ihrer Rechtsberatung.' },
    ],
    findings: [
      { title: 'ARR der Präsentation über dem fakturierten ARR', evidence: 'Rechnungspositionen gegen die Schlüsselkennzahl der Präsentation', term: 'Die Präsentation vor der Prüfung des Investors korrigieren' },
      { title: 'MFN-SAFE übernimmt einen späteren, niedrigeren Cap', evidence: 'Cap Table und das SAFE-Register', term: 'Mehr Umwandlungsanteile in jedem Szenario' },
      { title: 'Auftragnehmervertrag ohne Übertragung des geistigen Eigentums', evidence: 'Der Vertrag im Datenraum', term: 'Bestätigende Rechteübertragung vor dem Closing' },
    ],
    deliverables: [
      { title: 'Ein Aussagenregister', body: 'Jede Zahl der Präsentation mit ihrer Evidenz und ihrem Status.' },
      { title: 'Angebote nebeneinander', body: 'Die Konditionen jedes Investors und was den Gründern danach jeweils gehört.' },
      { title: 'Eine Investorenansicht', body: 'Bestätigte Zahlen und der Datenraum, ohne Vertrauliches darin.' },
    ],
    faq: [
      { q: 'Für wen ist das?', a: 'Für Gründer, die Pre-Seed-, Seed- oder Series-A-Kapital von Business Angels, Inkubatoren und Acceleratoren oder Venture-Fonds einwerben – der Gründer ist der Pactlab-Nutzer.' },
      { q: 'Kann ich mehrere Investoren vergleichen?', a: 'Ja. Das Gebot jedes Investors ist ein Angebot in derselben Finanzierungsrunde; das Rundenmodell läuft für jedes und zeigt sie nebeneinander, ohne sie zu reihen.' },
      { q: 'Gibt es Rechts- oder Finanzberatung?', a: 'Nein. Es zeigt die Mechanik und die Folgen jeder Kondition und die Evidenz hinter jeder Feststellung. Die Entscheidungen bleiben bei Ihnen und Ihren Beratern.' },
    ],
  },
  'multifamily-syndication': {
    headline: 'Prüfen Sie das Angebot gegen die Immobilie und den Vertrag.',
    subhead:
      'Eine Syndizierung sind zwei Deals zugleich: die Immobilie, die der Sponsor kauft, und das Angebot, in das Investoren einsteigen. Pactlab prüft die Immobilie mit dem Mehrfamilienhaus-Paket, liest PPM und Gesellschaftsvertrag, berechnet den Wasserfall neu und prüft jede Aussage an ihrer Evidenz.',
    illustrationAlt: 'Illustration einer Wohnanlage, eines Angebotsmemorandums und eines Ausschüttungswasserfalls.',
    pains: [
      { title: 'Ein prognostizierter IRR, den der Wasserfall nicht erreicht', body: 'Die Präsentation nennt eine Rendite; die eigenen Bedingungen des Gesellschaftsvertrags, auf die eigenen Erträge der Immobilie angewandt, ergeben eine andere.' },
      { title: 'Gebühren, die nur der Vertrag erwähnt', body: 'Eine Gebühr im Gesellschaftsvertrag, die die PPM-Zusammenfassung auslässt, ändert, was Investoren behalten.' },
      { title: 'Angaben zur Erfolgsbilanz ohne Grundlage', body: 'Ein früherer Deal, der in der Präsentation beschrieben ist, ohne hinterlegte tatsächliche Renditen, ist eine Behauptung, keine Bilanz.' },
    ],
    walkthrough: [
      { text: 'Mieterliste, T-12 und Begehungen laufen durch das Mehrfamilienhaus-Paket; PPM, Gesellschaftsvertrag, Präsentation und die Unterlagen des Sponsors zu früheren Deals werden mit ihrer Quelle gelesen.' },
      { text: 'Gebühren, Vorzugsrendite und Promote-Stufen werden aus den Dokumenten mit exakten Zitaten vorgeschlagen. Der Wasserfall wird aus den bestätigten Bedingungen neu berechnet, und jede Abweichung wird als Feststellung entworfen.' },
      { text: 'Der Sponsor bestätigt oder korrigiert jede extrahierte Bedingung; eine prüfende Person akzeptiert die Feststellungen und entscheidet jede Aussage als bestätigt, widerlegt oder unbestätigt.' },
      { text: 'Die Immobilie wird nach NOI und Cap Rate bepreist. Investorenrenditen nach Vorzugsrendite und Promote laufen in Abwärts-, Basis- und Aufwärtspfaden, als Szenarien aus angegebenen Annahmen gekennzeichnet.' },
      { text: 'Mängel im Angebot werden in den Dokumenten korrigiert, bevor Investoren sie sehen; Feststellungen zur Immobilie fließen hinter der Mauer in Preis und Konditionen mit dem Verkäufer ein.' },
    ],
    findings: [
      { title: 'Prognostizierter IRR über dem neu berechneten Wasserfall', evidence: 'Bedingungen des Gesellschaftsvertrags auf dem Ertragspfad der T-12', term: 'PPM und Präsentation vor der Kapitalbeschaffung korrigieren' },
      { title: 'Gebühr aus dem Gesellschaftsvertrag fehlt im PPM', evidence: 'Die Gebührenklausel des Vertrags gegen die Gebührenübersicht des PPM', term: 'Die Gebühr im PPM offenlegen' },
      { title: 'Angabe zu einem früheren Deal ohne Ist-Werte', evidence: 'Die Aussage zur Erfolgsbilanz in der Präsentation gegen die Unterlagen zu früheren Deals', term: 'Unbestätigte Aussage, bis Ist-Werte vorliegen' },
    ],
    deliverables: [
      { title: 'Ein Register der Angebotsaussagen', body: 'Jede wesentliche Aussage mit ihrer Evidenz und ihrem Status.' },
      { title: 'Eine Wasserfallprüfung', body: 'Angegebene gegen neu berechnete Renditen, mit ausgeschriebenen Konventionen.' },
      { title: 'Eine Tabelle zur Erfolgsbilanz', body: 'Frühere Deals, Prognose gegen Ist, Fehlendes als fehlend gezeigt.' },
    ],
    faq: [
      { q: 'Worin unterscheidet sich das vom Mehrfamilienhaus-Paket?', a: 'Das Mehrfamilienhaus-Paket ist ein Verkauf zwischen zwei Parteien. Eine Syndizierung ergänzt die Kapitalbeschaffung: Der Sponsor prüft die Immobilie, und das Angebot wird gegen die Immobilie, den Gesellschaftsvertrag und die Erfolgsbilanz des Sponsors geprüft. Die Prüfungen zur Immobilie sind die des Mehrfamilienhaus-Pakets, unverändert.' },
      { q: 'Prüft Pactlab die Akkreditierung?', a: 'Nein. Pactlab trifft keine Feststellung zur Akkreditierung. Es verfolgt den Status jedes Investors und den Verweis auf die Evidenz des Spezialisten, der sie geprüft hat.' },
      { q: 'Ist das Rechtsberatung oder ein Dienst für Wertpapierangebote?', a: 'Nein. Es ist Unterstützung bei der Due Diligence: Es ordnet Evidenz und markiert Lücken für die Parteien und ihre Rechtsberatung. Es übernimmt keine Funktion eines Wertpapierangebots oder Broker-Dealers.' },
      { q: 'Kann der Verkäufer die Kapitalbeschaffung sehen?', a: 'Nein. Das Angebot ist die eigene Seite des Sponsors im Pakt. Der Verkäufer sieht die Kapitalbeschaffung nie, und Investoren sehen die Übernahmeverhandlung nie.' },
    ],
  },
  'music-rights': {
    headline: 'Kaufen Sie die Tantiemen, die Sie belegen können.',
    subhead:
      'Ein Musikkatalog wird für seine Tantiemeneinnahmen gekauft, und die Due Diligence scheitert auf prüfbare Weise: ein Hit ohne Rechteübertragung, Anteile, die sich auf 105 % summieren, Rechteeinräumungen, die Urheber während Ihrer Haltedauer kündigen können. Pactlab baut das Register aus Abrechnungen und Registrierungen auf, modelliert die Einnahmen und beziffert das Kündigungsrisiko.',
    illustrationAlt: 'Illustration eines Musikkatalogs: Schallplatten, eine Tantiemenabrechnung und ein Rechteregister.',
    pains: [
      { title: 'Einnahmen ohne Rechtsgrundlage', body: 'Ein Werk verdient in jeder Abrechnung, aber nichts in der Rechtekette zeigt, wie der Verkäufer es erworben hat.' },
      { title: 'Rechte, die zurückfallen können', body: 'Vor Jahrzehnten eingeräumte Rechte werden nach US-Urheberrecht kündbar, mitunter mitten in der Haltedauer.' },
      { title: 'Einnahmen, die schon ausgegeben sind', body: 'Ein nicht verrechneter Vorschuss im Hauptbuch des Verwalters nimmt die Tantiemen, bevor sie den Eigentümer erreichen.' },
    ],
    walkthrough: [
      { text: 'Werkregister, Urheberanteile, Rechtekette und Tantiemenabrechnungen kommen als Importe; Abrechnungen, Split Sheets, Verträge und Pfandrechtsrecherchen werden mit ihrer Quelle gelesen.' },
      { text: 'Deterministische Prüfungen entwerfen Lücken in der Rechtekette, abweichende Anteile, Kündigungsrisiken, Konzentration, nicht verrechnete Vorschüsse, nicht offengelegte Pfandrechte und fehlende Abrechnungsperioden, jeweils mit Beleg.' },
      { text: 'Aus Dokumenten gelesene Einträge werden von einem Menschen bestätigt oder korrigiert, bevor sie zählen; eine prüfende Person akzeptiert jede Feststellung oder lehnt sie ab.' },
      { text: 'Ein Tantiemen-Multiple auf die laufenden, um den Rückgang bereinigten Nettoeinnahmen, mit dem Kündigungsrisiko als eigener Zeile auf der Brücke.' },
      { text: 'Lücken in der Rechtekette werden zu einem Einbehalt, die betroffenen Einnahmen zu einer Kaufpreisminderung und ein nicht offengelegtes Pfandrecht zu einer Freistellung, jeweils bis zu ihrer Quelle nachvollziehbar.' },
    ],
    findings: [
      { title: 'Erfolgreiches Werk ohne hinterlegte Rechteübertragung', evidence: 'Die Rechtekette gegen die Abrechnungseinnahmen des Werks', term: 'Einbehalt, bis die Rechteübertragung vorliegt' },
      { title: 'Kündigungsfenster innerhalb der Haltedauer', evidence: 'Einräumungsdaten gegen die Fenster nach §203 und §304, auf laufende Einnahmen', term: 'Kaufpreisminderung auf den betroffenen Anteil' },
      { title: 'Nicht verrechneter Vorschuss fehlt in der Zusammenfassung', evidence: 'Das Hauptbuch des Verwalters gegen die Zusammenfassung des Verkäufers', term: 'Wird vom Preis abgezogen' },
    ],
    deliverables: [
      { title: 'Ein Register der Werke und Rechte', body: 'Jedes Werk mit seinen Einnahmen, Anteilen, Belegen zur Rechtekette und seinem Kündigungsfenster.' },
      { title: 'Ein Einnahmenmodell', body: 'Laufende Einnahmen nach Quelle und Katalogalter, mit ausgeschriebener Rückgangsbereinigung.' },
      { title: 'Eine Übersicht des Kündigungsrisikos', body: 'Welche Rechteeinräumungen sich innerhalb der Haltedauer öffnen und wie viel Einnahmen dahinterstehen.' },
    ],
    faq: [
      { q: 'Sagt mir Pactlab, ob die Rechtekette in Ordnung ist?', a: 'Nein. Es ist Unterstützung bei der Due Diligence, keine Rechtsberatung: Es ordnet die Evidenz und markiert Lücken in der Rechtekette für Sie und Ihre Rechtsberatung. Es stellt nicht fest, dass die Rechte einwandfrei sind.' },
      { q: 'Entscheidet es, ob eine Kündigungserklärung wirksam ist?', a: 'Nein. Es berechnet die Fenster nach §203 und §304 aus den Einräumungsdaten, nennt seine Konventionen und beziffert die Einnahmen dahinter. Ob eine Erklärung wirksam zugestellt wurde oder werden könnte, beurteilt Ihre Rechtsberatung.' },
      { q: 'Woher kommen die Einnahmenzahlen?', a: 'Nur aus Tantiemenabrechnungen, Registern und angebundenen Quellen. Eine fehlende Abrechnungsperiode wird als Lücke gezeigt, nie geschätzt.' },
      { q: 'Erhöht Wachstum den Preis?', a: 'Nein. Das Multiple gilt für die um den Rückgang bereinigten Einnahmen: Rückgänge senken sie, Wachstum wird nie hinzugerechnet. Bestätigtes Wachstum und eine einwandfreie Rechtekette werden als bestätigter Wert erfasst.' },
    ],
  },
  'energy-generation': {
    headline: 'Bepreisen Sie die Verbindlichkeiten, bevor Sie sie erben.',
    subhead:
      'Kraftwerke sowie Öl- und Gasbeteiligungen werden nach Eigentumsketten, Förder- und Reservendaten, Verträgen – und großen, bezifferbaren Verpflichtungen – gehandelt. Pactlab baut das Register der Anlagen und Beteiligungen auf, prüft die Förderung gegen das Reservengutachten und stellt jede Sanierungs- und Rückbauschätzung dem gegenüber, was der Verkäufer verbucht hat.',
    illustrationAlt: 'Illustration eines Kraftwerks, eines Bohrplatzes und einer Verbindlichkeitenaufstellung.',
    pains: [
      { title: 'Verpflichtungen, die in der Aufstellung fehlen', body: 'Ein Stilllegungsplan für ein Ascheabsetzbecken liegt im Datenraum, und die Verbindlichkeitenaufstellung verbucht nichts dafür.' },
      { title: 'Flächen mit Ablaufdatum', body: 'Pachten, die nicht durch Förderung gehalten werden, laufen während der Haltedauer aus, und der Wert geht mit ihnen.' },
      { title: 'Anteile, die nicht aufgehen', body: 'Eine Division Order zahlt einen Anteil, den die Lizenzgebührenkette der Pacht nicht stützt, und der Betreiber kann ihn zurückfordern.' },
    ],
    walkthrough: [
      { text: 'Anlagen- und Beteiligungsregister, Pachten, Förderung und die Verbindlichkeitenaufstellung kommen als Importe; Reservengutachten, Rechtsgutachten zum Eigentum, Genehmigungen und Studien werden mit ihrer Quelle gelesen.' },
      { text: 'Deterministische Prüfungen entwerfen nicht verbuchte Verbindlichkeiten, ARO-Fehlbeträge, abweichende Rückgänge, auslaufende Pachten, Anteilsfehler, PPA-Klippen, Brüche in der Eigentumskette und Lücken bei Compliance-Investitionen, jeweils mit Beleg.' },
      { text: 'Aus Gutachten gelesene Einträge werden von einem Menschen bestätigt oder korrigiert, bevor sie zählen; eine prüfende Person akzeptiert jede Feststellung oder lehnt sie ab.' },
      { text: 'Ein reservenbasierter DCF für die Beteiligungen und $/kW plus Vertragsdeckung für die Anlagen, über die Standardbrücke.' },
      { text: 'Nicht verbuchte Sanierung wird zu einer Kaufpreisminderung, der ARO-Fehlbetrag zu einem Treuhandeinbehalt und ein Bruch in der Eigentumskette zu einer Heilungsfrist oder einem Einbehalt, jeweils bis zu ihrer Quelle nachvollziehbar.' },
    ],
    findings: [
      { title: 'Stilllegung des Ascheabsetzbeckens fehlt in der Verbindlichkeitenaufstellung', evidence: 'Die Schätzung des Stilllegungsplans gegen die Aufstellung des Verkäufers', term: 'Sanierungskosten vom Preis abgezogen' },
      { title: 'Rückbauverpflichtung um 40 % zu niedrig verbucht', evidence: 'Die Rückbaustudie gegen die verbuchte ARO', term: 'Treuhandeinbehalt in Höhe des Fehlbetrags' },
      { title: 'Ein Viertel der Fläche läuft innerhalb der Haltedauer aus', evidence: 'Laufzeiten und Förderstatus aus der Pachtübersicht', term: 'Ein Abschlag auf den betroffenen Anteil' },
    ],
    deliverables: [
      { title: 'Ein Register der Anlagen und Beteiligungen', body: 'Jede Anlage und Beteiligung mit Vertrag, Pacht, Anteil und Förderung.' },
      { title: 'Eine Sicht auf Förderung und Reserven', body: 'Der tatsächliche Rückgang gegen die Annahme des Gutachtens; Reserven so, wie die Ingenieure sie angeben.' },
      { title: 'Eine geprüfte Verbindlichkeitenaufstellung', body: 'Jede Sanierungs- und Rückbauschätzung gegen das, was der Verkäufer verbucht hat, mit der Lücke.' },
    ],
    faq: [
      { q: 'Schätzt Pactlab Reserven?', a: 'Nein. Reservenzahlen stammen nur aus dem Gutachten eines unabhängigen Ingenieurbüros, als solches belegt und von einem Menschen bestätigt. Ein fehlendes Gutachten wird als Lücke gezeigt, nie aufgefüllt.' },
      { q: 'Sagt es mir, ob das Eigentum einwandfrei ist?', a: 'Nein. Es ist Unterstützung bei der Due Diligence, keine Rechts-, Ingenieur- oder Regulierungsberatung: Es ordnet die Evidenz und markiert Brüche in der Eigentumskette für Sie und Ihre Rechtsberatung. Es trifft keine Feststellung zum Eigentum.' },
      { q: 'Woher kommen die Zahlen zu den Verbindlichkeiten?', a: 'Nur aus Gutachten, Genehmigungen und der Aufstellung des Verkäufers. Pactlab vergleicht die Schätzung der Evidenz mit dem Verbuchten; es schätzt selbst nie eine Verbindlichkeit.' },
      { q: 'Erhöhen ein einwandfreies Eigentum oder eine zu hoch verbuchte ARO den Preis?', a: 'Nein. Bestätigte Puffer werden als bestätigter Wert erfasst, nie als Preiserhöhung.' },
    ],
  },
  'startup-spv': {
    headline: 'Bündeln Sie das Geld in einer Runde, deren Zahlen aufgehen.',
    subhead:
      'Ein SPV-Organisator steht jedem Investor für zwei Dinge ein: die Finanzierungsrunde des Start-ups und die eigenen Bedingungen des Vehikels. Pactlab berechnet die Cap Table mit jedem umgewandelten SAFE neu, prüft jede Aussage der Präsentation an ihrer Evidenz, berechnet Gebühr und Carry aus dem Gesellschaftsvertrag neu und veröffentlicht an Investoren nur, was Sie teilen wollen.',
    illustrationAlt: 'Illustration eines Bündelungsvehikels: mehrere Investoren, die sich zu einer Position auf der Cap Table eines Start-ups vereinen.',
    pains: [
      { title: 'Eine Cap Table, die nicht aufgeht', body: 'Die Rundenzusammenfassung vergisst, dass die SAFEs umgewandelt werden, also besitzt das Vehikel weniger, als allen gesagt wurde.' },
      { title: 'Bedingungen, die sich unterwegs geändert haben', body: 'Der Gesellschaftsvertrag sagt 20 % Carry; die Zusammenfassung, auf deren Basis die Investoren gezeichnet haben, sagt 15 %.' },
      { title: 'Nebenabreden und Zulassung', body: 'Ein Side Letter erlässt einem Investor die Gebühr, und ein Investor in einem 506(c)-Vehikel wurde nie verifiziert.' },
    ],
    walkthrough: [
      { text: 'Abrechnung, Cap Table und Liquidität des Start-ups kommen als Importe; Rundenzusammenfassung, SAFEs, Gesellschaftsvertrag, Investorenzusammenfassung, Side Letters und Form D werden mit ihrer Quelle gelesen.' },
      { text: 'Deterministische Prüfungen entwerfen Lücken in Cap Table und Rundenrechnung, widerlegte oder nicht gestützte Aussagen, Abweichungen bei Gebühr und Carry, nicht offengelegte Side Letters, Lücken bei der Akkreditierung und ein fehlendes Form D, jeweils mit Beleg.' },
      { text: 'Eine prüfende Person akzeptiert jede Feststellung oder lehnt sie ab; das Aussagenregister zeigt jede Aussage der Präsentation als bestätigt, widerlegt oder unbestätigt.' },
      { text: 'Die Pre-Money-Bewertung der Runde aus Preis und Anteilszahl neu berechnet und Renditeszenarien nach Gebühren auf den Exit-Pfaden, die Sie angeben.' },
      { text: 'Was Sie an Investoren veröffentlichen, ist eine eingefrorene, versionierte Momentaufnahme: das Aussagenregister, die Rundenprüfung, die Ökonomie des Vehikels und die Szenarien – sonst nichts.' },
    ],
    findings: [
      { title: 'Anteile nach der Runde ohne die SAFE-Umwandlung', evidence: 'Die Cap Table mit jedem umgewandelten SAFE gegen die Rundenzusammenfassung', term: 'Die Zusammenfassung korrigieren, bevor sich das Vehikel verpflichtet' },
      { title: 'Carry weicht von der Investorenzusammenfassung ab', evidence: 'Der Gesellschaftsvertrag gegen die Zusammenfassung der Bedingungen', term: 'Korrigieren und den Investoren erneut offenlegen' },
      { title: 'Nicht offengelegter Gebührenerlass in einem Side Letter', evidence: 'Der Side Letter gegen die Offenlegung in der Zusammenfassung', term: 'Jedem Investor offenlegen oder zurückziehen' },
    ],
    deliverables: [
      { title: 'Eine Rundenprüfung', body: 'Jede Umwandlung, die Pre-Money-Bewertung und die Anteilszahl nach der Runde neu berechnet, mit Pro-rata-Rechten je Instrument.' },
      { title: 'Eine Prüfung der Ökonomie des Vehikels', body: 'Gebührenlast und Carry aus dem Gesellschaftsvertrag, dem gegenübergestellt, was den Investoren gesagt wurde.' },
      { title: 'Eine veröffentlichte Investorenansicht', body: 'Versioniert und eingefroren; die Bedingungen eines Investors erscheinen nie in der Ansicht eines anderen.' },
    ],
    faq: [
      { q: 'Prüft Pactlab die Akkreditierung?', a: 'Nein. Die Akkreditierung wird nachverfolgt, nicht festgestellt: Sie erfassen, was ein Verifizierungsspezialist ermittelt hat, mit einem Link und einem Evidenzverweis, und die Prüfungen markieren Lücken für Sie und Ihre Rechtsberatung.' },
      { q: 'Ist das Rechts- oder Wertpapierberatung?', a: 'Nein. Es ist ausschließlich Unterstützung bei der Due Diligence: Pactlab übernimmt keine Funktion eines Wertpapierangebots, Broker-Dealers oder Anlageberaters. Es ordnet die Evidenz und markiert Lücken für die Parteien und ihre Rechtsberatung.' },
      { q: 'Können Investoren einander oder die Side Letters sehen?', a: 'Nein. Jeder Investor sieht seinen eigenen Platz und die Investorenansicht, die Sie veröffentlichen; Side Letters, andere Investoren und Ihre eigene Analyse gelangen nie hinein. Das Start-up sieht die Investorenliste nie.' },
      { q: 'Sind die Renditeszenarien eine Prognose?', a: 'Nein. Sie werden aus Exit-Pfaden berechnet, die Sie angeben, nach Gebühren und Carry des Vehikels, und als Szenarien gekennzeichnet – nie eine Vorhersage oder ein Versprechen.' },
    ],
  },
  'small-clinics': {
    headline: 'In einer kleinen Praxis liegt das Risiko bei einem Inhaber, einem Zuweiser und einem Mietvertrag.',
    subhead:
      'Kleine Praxen werden auf Basis derselben Evidenz gehandelt wie größere Versorgergruppen, aber die Risiken bündeln sich. Pactlab liest Einnahmen, Zulassungen und Kostenträgerverträge so wie das Gesundheitspaket und berechnet dann neu, wie viel der verkaufende Inhaber selbst erbringt, woher die Patienten kommen und wie lange die Räume gesichert sind – Dokumente, Daten und Rechnungen, nie ein klinisches oder rechtliches Urteil.',
    illustrationAlt: 'Illustration einer kleinen Praxis, eines aggregierten Behandlerplans und eines Abrechnungsberichts.',
    pains: [
      { title: 'Der Inhaber ist die margenstärkste Leistung', body: 'Der verkaufende Inhaber ist der einzige Erbringer des profitabelsten Leistungsbereichs, und kein angestellter Behandler deckt ihn ab.' },
      { title: 'Ein Zuweiser schickt die meisten Patienten', body: 'Mehr als die Hälfte der Besuche kommt von einem Krankenhaus oder einer Praxis; hört es auf zuzuweisen, sinkt das Volumen.' },
      { title: 'Ein Mietvertrag, der kurz nach dem Closing endet', body: 'Die Laufzeit endet etwa ein Jahr nach dem Closing, ohne Verlängerungsoption, und die Übertragung braucht die Zustimmung des Vermieters.' },
    ],
    walkthrough: [
      { text: 'Zahlungsavise, Einnahmen je Behandler, das Zulassungs- und das Kostenträgervertragsregister, Leistungsbereiche je Behandler, Besuche je Zuweiser, Patientenvolumen, die Geräteübersicht und die GuV je Jahr kommen als Importe; Memorandum, Mietvertrag, Zulassungsnachweise und Richtlinien werden mit ihrer Quelle gelesen.' },
      { text: 'Deterministische Prüfungen entwerfen einen Leistungsbereich, den nur der Inhaber erbringt, einen Inhaberanteil ohne hinterlegte Nachfolge, einen dominanten Zuweiser, einen kurzen Mietvertrag ohne Verlängerung, eine Zustimmungspflicht zur Übertragung, Kosten, die dem Umsatz davonlaufen, Kodierung über der Richtlinie und veraltete Geräte, jeweils mit Beleg auf die Zeilen oder die Seite.' },
      { text: 'Eine namentlich benannte prüfende Person akzeptiert jede Feststellung, lehnt sie ab oder fordert Belege an; nichts wird von der Software entschieden.' },
      { text: 'DCF-Szenarien mit akzeptierten Feststellungen auf der Kaufpreisbrücke: Abhängigkeit von Inhaber und Zuweisern als Abschläge, die die prüfende Person bepreist, Umzugsrisiko und Geräteersatz als Anpassungen.' },
      { text: 'Eine Übergangsvereinbarung oder ein Earn-out, geknüpft an den Leistungsbereich des Inhabers, die Zustimmung des Vermieters oder ein neuer Mietvertrag als Closing-Bedingung, jeweils bis zu ihrer Quelle nachvollziehbar.' },
    ],
    findings: [
      { title: '58 % der Besuche kommen von einem Zuweiser', evidence: 'Besuche je Zuweiser, neu berechnet aus dem Terminexport', term: 'Ein Abschlag auf die Besuche, die der Preis voraussetzt' },
      { title: 'Der Mietvertrag endet 14 Monate nach dem Closing ohne Verlängerungsoption', evidence: 'Enddatum und Verlängerungssatz des Mietvertrags gegen das angegebene Closing-Datum', term: 'Umzugs- oder Neuverhandlungsrisiko bepreist oder ein neuer Mietvertrag als Closing-Bedingung' },
      { title: 'Der verkaufende Inhaber ist der einzige Erbringer des margenstärksten Leistungsbereichs', evidence: 'Leistungsbereiche je Behandler, mit Margen nach direkten Kosten', term: 'Eine Übergangsvereinbarung oder ein Earn-out' },
    ],
    deliverables: [
      { title: 'Der Inhaber in Zahlen', body: 'Der Anteil des verkaufenden Inhabers an Besuchen und Einnahmen und die Leistungsbereiche, die nur er erbringt.' },
      { title: 'Die Räume, aus dem Mietvertrag gelesen', body: 'Restlaufzeit nach dem Closing, Verlängerung und Übertragung, jeweils mit dem zitierten Satz.' },
      { title: 'Die GuV über alle Jahre', body: 'Umsatz, Margen sowie Material-, Labor-, Personal- und Raumkosten im Verhältnis zum Umsatz, Jahr für Jahr.' },
    ],
    faq: [
      { q: 'Wie hängt das mit dem Gesundheitspaket zusammen?', a: 'Es ist das Gesundheitspaket, zugeschnitten auf wenige Standorte. Die Prüfungen zu Zahlungsavisen, Zulassungen und Kostenträgerverträgen laufen genau wie dort; das Paket für kleine Praxen ergänzt die Prüfungen zu Inhaber, Zuweisern und Mietvertrag.' },
      { q: 'Wie werden Behandlerdaten behandelt?', a: 'Behandler, einschließlich des verkaufenden Inhabers, erscheinen nur als pseudonyme Kennungen wie P01. Ihre Zahlen bleiben in deterministischem Code und werden nie an ein Modell gesendet.' },
      { q: 'Beurteilt es, ob eine Zuweisungsvereinbarung oder ein Mietvertrag rechtmäßig ist?', a: 'Nein. Es berichtet Anteile, Daten und die Sätze, die die Dokumente enthalten. Klinisches und rechtliches Urteil liegen bei Ihren Medizinern und Ihrer Rechtsberatung.' },
      { q: 'Welche Praxen deckt es ab?', a: 'Arzt-, Zahnarzt-, Tierarzt- und Therapiepraxen mit wenigen Standorten.' },
    ],
  },
  hospitals: {
    headline: 'Ein Krankenhaus, das sind seine Kostenberichte, seine Kostenträgerverträge, sein ärztliches Personal und seine Anlagen.',
    subhead:
      'Krankenhäuser haben Evidenz, die kein anderes Unternehmen hat. Pactlab gleicht die eingereichten Kostenberichte mit der Präsentation und den Abschlüssen ab, liest jeden wesentlichen Kostenträgervertrag gegen das Closing, prüft Zulassungen und Behandlungsprivilegien des ärztlichen Personals Abteilung für Abteilung und setzt die Investitionen über jedes Jahr ins Verhältnis zum Umsatz – Dokumente, Daten und Arithmetik, nie eine Prognose einer Begehung oder ein Urteil über die Versorgung.',
    illustrationAlt: 'Illustration eines Krankenhausgebäudes, eines Diagramms zum Kostenträgermix und einer Akkreditierungsurkunde.',
    pains: [
      { title: 'Eine Präsentation, die die Kostenberichte nicht stützen', body: 'Die Belegung in der Präsentation liegt deutlich über dem, was Pflegetage und Bettentage im eingereichten Kostenbericht ergeben.' },
      { title: 'Der Vertrag des größten Kostenträgers endet nach dem Closing', body: 'Der Vertrag hinter dem Großteil des Umsatzes läuft wenige Monate nach Beginn des ersten Eigentumsjahres aus.' },
      { title: 'Aufgeschobene Investitionen hinter dem Versprechen moderner Anlagen', body: 'Die Investitionen sinken jedes Jahr ein wenig, sodass kein einzelnes Jahr auffällt, während die Präsentation die Anlagen modern nennt.' },
    ],
    walkthrough: [
      { text: 'Die eingereichten Kostenberichte, der Kostenträgermix, das Register der Kostenträgerverträge, Dienstplan und Register des ärztlichen Personals, die Belegung, die Investitionen je Jahr und die GuV je Jahr kommen als Importe; Präsentation, Akkreditierungsunterlage, Kostenträgerverträge, Zulassungsprüfungen, Gebäudezustandsgutachten und Qualitätsberichte werden mit ihrer Quelle gelesen.' },
      { text: 'Deterministische Prüfungen entwerfen widerlegte oder bestätigte Angaben aus den Kostenberichten, einen wesentlichen Kostenträgervertrag, der innerhalb eines Jahres nach dem Closing endet, eine Abteilung, deren Privilegien gemeinsam ablaufen, sinkende Investitionen gegen das Versprechen moderner Anlagen und Qualitätsangaben gegen die Berichte, jeweils mit den Zeilen oder der Seite belegt.' },
      { text: 'Eine benannte prüfende Person akzeptiert, verwirft oder verlangt Belege für jede Feststellung; das Register der Angaben zeigt jede Angabe der Präsentation als bestätigt, widerlegt oder ungeprüft.' },
      { text: 'Kostenträgermix-bereinigtes EBITDA und DCF-Szenarien, mit zugesagten regulatorisch bedingten Investitionen und aufgeschobenen Arbeiten an den Anlagen in der Kaufpreisbrücke.' },
      { text: 'Eine Vertragsverlängerung beim Kostenträger oder die erneute Privilegienvergabe als Closing-Bedingungen, der Akkreditierungsantrag beim Eigentümerwechsel und Investitions-Treuhandeinbehalte, jeweils auf ihre Quelle zurückgeführt.' },
    ],
    findings: [
      { title: 'Der Vertrag des größten Kostenträgers endet 7 Monate nach dem Closing', evidence: 'Das Register der Kostenträgerverträge und das Ablaufdatum im Vertrag selbst, gegen das angegebene Closing-Datum', term: 'Eine bepreiste Satzsensitivität oder eine Verlängerung als Closing-Bedingung' },
      { title: 'Der Kostenbericht widerlegt die Präsentation bei der Belegung', evidence: 'Pflegetage auf verfügbare Bettentage aus dem eingereichten Kostenbericht, gegen die Zahl der Präsentation', term: 'Die Zahl des Kostenberichts in den Szenarien führen' },
      { title: 'Orthopädie: Privilegien von vier Ärzten gemeinsam abgelaufen', evidence: 'Das Register des ärztlichen Personals und der Prüfbericht, über pseudonyme Kennungen', term: 'Erneute Privilegienvergabe als Closing-Bedingung' },
    ],
    deliverables: [
      { title: 'Ein Abgleich der Kostenberichte', body: 'Belegung, Kostenträgermix und Kosten aus den eingereichten Berichten, gegen die Präsentation und die GuV, Jahr für Jahr.' },
      { title: 'Ein Register des ärztlichen Personals', body: 'Zulassungen und Privilegien je Abteilung zum Analysestichtag, mit den Abteilungen, die gemeinsam ablaufen.' },
      { title: 'Kostenträgermix-bereinigtes EBITDA', body: 'Erträge, bereinigt um den Kostenträgermix, mit regulatorisch bedingten Investitionen und aufgeschobenen Arbeiten an den Anlagen als Sanierung.' },
    ],
    faq: [
      { q: 'Wie hängt das mit dem Gesundheitspaket zusammen?', a: 'Es erweitert es. Die Register des ärztlichen Personals und der Kostenträgerverträge sind die des Gesundheitspakets, im Maßstab eines Krankenhauses gelesen; das Krankenhauspaket ergänzt die Kostenberichte, den Investitionstrend der Anlagen und veröffentlichte Qualitätsbewertungen.' },
      { q: 'Sind dabei Patientendaten im Spiel, oder wird die Qualität der Versorgung beurteilt?', a: 'Nein. Das Paket arbeitet aggregiert mit Kostenberichten, Kostenträger-, Belegungs- und Registerdaten, Ärzte nur über pseudonyme Kennungen. Es vergleicht Qualitätsbewertungen mit den vorgelegten Berichten; es sagt nie das Ergebnis einer Begehung voraus und beurteilt nie die Versorgung.' },
      { q: 'Wie werden regulatorisch bedingte Investitionen und aufgeschobene Arbeiten an den Anlagen behandelt?', a: 'Als bepreiste Feststellungen. Einmal akzeptiert, sind sie eine Sanierung in der Bewertung und ein Treuhandeinbehalt oder eine Kaufpreisanpassung in den Konditionen.' },
    ],
  },
};
