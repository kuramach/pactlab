import type { Catalog } from '../../lib/i18n/catalog';

/** French industry stories: walkthroughs, example findings and FAQs (machine translation, T-171). */
export const stories: Catalog['stories'] = {
  'software-saas': {
    headline: 'Sachez que l’ARR est réel avant de payer un multiple dessus.',
    subhead:
      'Les deals logiciels se valorisent sur les revenus récurrents et sur une base de code que la plupart des acheteurs ne lisent jamais. Pactlab contrôle les deux à la source, et chaque constat qu’un réviseur accepte se répercute directement dans le prix.',
    illustrationAlt: 'Illustration d’une fenêtre d’application avec du code, un graphique d’ARR en hausse et un graphe de commits.',
    pains: [
      { title: 'Un ARR qui n’existe que dans la présentation', body: 'L’ARR de la direction correspond rarement à la facturation au centime près, et c’est dans l’écart que se cache le risque de prix.' },
      { title: 'Un ingénieur qui porte le produit', body: 'Les entretiens décrivent l’équipe ; l’historique des commits montre qui construit réellement quoi.' },
      { title: 'Des licences qui viennent avec', body: 'Des composants copyleft dans un produit livré peuvent changer ce que vous achetez.' },
    ],
    walkthrough: [
      { text: 'Les exports de facturation, le dépôt de code et l’outil de suivi de livraison sont connectés pour le deal. Chaque enregistrement est haché et conservé avec sa source.' },
      { text: 'L’ARR facturé est inférieur à celui du data book ; un scanner signale une dépendance copyleft ; l’historique des commits montre un seul ingénieur derrière le système de facturation.' },
      { text: 'Un réviseur accepte l’écart d’ARR avec le pont joint et demande des justificatifs sur le constat de licence avant de trancher.' },
      { text: 'Les risques acceptés deviennent des ajustements chiffrés ; le scénario est recalculé et montre exactement comment et pourquoi le prix a bougé.' },
      { text: 'L’écart d’ARR devient un ajustement de prix et l’exposition aux licences une garantie d’indemnisation, chacun lié à ses preuves.' },
    ],
    findings: [
      { title: 'L’ARR de la direction dépasse l’ARR facturé', evidence: 'Lignes de facture rapprochées du chiffre d’ARR déclaré', term: 'Ajustement du prix d’acquisition' },
      { title: 'Composant copyleft dans l’agent livré', evidence: 'Nomenclature logicielle au commit analysé', term: 'Garantie d’indemnisation spécifique et plan de remédiation' },
      { title: 'Le sous-système de facturation dépend d’un seul contributeur', evidence: 'Historique des commits, agrégé par sous-système', term: 'Dispositif de rétention dans le plan d’intégration' },
    ],
    deliverables: [
      { title: 'Un pont d’ARR approuvé', body: 'De la présentation au grand livre, avec l’écart validé.' },
      { title: 'Un registre des risques chiffrés', body: 'Chaque constat accepté avec ses preuves, son réviseur et sa fourchette de prix.' },
      { title: 'Une évaluation figée', body: 'Soumise, approuvée par une seconde personne et jamais réécrite.' },
    ],
    faq: [
      { q: 'Pactlab conserve-t-il le code source de notre cible ?', a: 'Non. Les dépôts sont analysés dans des espaces de travail éphémères, détruits ensuite. Les constats conservent les chemins, les empreintes et les versions des outils, jamais le code.' },
      { q: 'Qui décide de ce qui constitue un vrai risque ?', a: 'Vos réviseurs. Analystes, scanners et modèles peuvent rédiger des constats ; seule une personne désignée peut les accepter, et rien n’atteint l’évaluation avant qu’elle ne le fasse.' },
      { q: 'De quoi avons-nous besoin pour commencer ?', a: 'Un deal en cours, l’accès à sa facturation, à son code, à ses données de livraison et à ses documents, et les personnes qui feront la revue. C’est cela, un pilote.' },
    ],
  },
  fintech: {
    headline: 'Contrôlez le volume et les agréments avant de les payer.',
    subhead:
      'Les deals fintech se valorisent sur des chiffres de volume et de croissance qui se trouvent dans les exports des processeurs, et sur des agréments qui peuvent expirer sans bruit. Pactlab recalcule le volume, le taux de commission et les taux de pertes à partir des exports, confronte la présentation à ces chiffres, lit le statut et l’échéance de chaque agrément et exécute le socle logiciel tel quel.',
    illustrationAlt: 'Illustration d’une carte de paiement, d’une banque et d’un bouclier, reliés par un flux de transactions.',
    pains: [
      { title: 'Un chiffre de volume que les exports ne justifient pas', body: 'Le TPV de la présentation compte deux fois un mois de processeur, et le prix est fixé dessus.' },
      { title: 'Un agrément expiré sans bruit', body: 'Un agrément d’État a expiré il y a des mois, et le registre indique toujours actif.' },
      { title: 'Des taux de pertes proches d’un plafond contractuel', body: 'Les rétrofacturations dépassent le seuil que la banque partenaire a inscrit dans l’accord.' },
    ],
    walkthrough: [
      { text: 'Les exports des processeurs, le registre des agréments, le fichier de prêts, les alertes LCB-FT et le compte de résultat par année arrivent en imports ; la présentation, les agréments, l’accord de partenariat et les documents de conformité sont lus avec leur source.' },
      { text: 'Des contrôles déterministes rédigent les affirmations contredites, les agréments expirés ou proches de l’échéance, les dépassements de seuils de pertes, les revenus non rapprochés, les coûts qui progressent plus vite que les revenus et les preuves de conformité manquantes, chacun avec sa citation.' },
      { text: 'Un réviseur désigné accepte, rejette ou demande des justificatifs pour chaque constat ; rien n’est décidé par le logiciel.' },
      { text: 'Des scénarios de multiple d’ARR et de DCF comme pour tout deal logiciel, avec les constats acceptés sur le pont de prix d’acquisition.' },
      { text: 'Un agrément expiré chiffré en séquestre ou en garantie d’indemnisation, ou sa restauration en condition suspensive ; un dépassement chiffré en retenue, chacun remontant à sa source.' },
    ],
    findings: [
      { title: 'Le TPV de la présentation compte deux fois un mois de processeur', evidence: 'Le chiffre de la présentation face aux exports des processeurs', term: 'Une décote sur le volume que suppose le prix' },
      { title: 'Agrément d’État de transmetteur de fonds expiré depuis quatre mois', evidence: 'L’échéance indiquée sur l’agrément face au registre', term: 'Restauration en condition suspensive, ou un séquestre' },
      { title: 'Taux de rétrofacturation au-dessus du seuil de l’accord de partenariat', evidence: 'Taux trimestriels tirés des exports face à la clause', term: 'Une retenue de réserve' },
    ],
    deliverables: [
      { title: 'Un volume et un taux de commission traçables', body: 'TPV, transactions et taux de commission recalculés à partir des exports, avec les lignes derrière chaque chiffre.' },
      { title: 'Un registre des agréments contrôlé', body: 'Chaque agrément et accord de partenariat avec son statut et son échéance, tirés du registre et des documents.' },
      { title: 'Le compte de résultat sur toutes les années', body: 'Revenus, marges, et coûts de fraude, de crédit et de traitement rapportés aux revenus, année par année.' },
    ],
    faq: [
      { q: 'La due diligence logicielle s’applique-t-elle quand même à une cible fintech ?', a: 'Oui. Les cibles fintech sont des entreprises technologiques : la revue des revenus, du code, de la livraison, de la sécurité et des contrats se fait comme pour tout deal logiciel. Le pack fintech y ajoute les contrôles sur les paiements, les agréments, les taux de pertes et la conformité.' },
      { q: 'Quelles preuves le pack fintech lit-il ?', a: 'Les exports de règlement des processeurs ou des banques, le registre des agréments et des partenariats bancaires, le fichier de prêts, les alertes LCB-FT et le compte de résultat par année, ainsi que la présentation, les agréments, l’accord de partenariat et les documents de conformité. Chaque constat cite les lignes ou la page sur lesquelles il repose.' },
      { q: 'Me dit-il si un agrément est nécessaire, ou si un programme est conforme ?', a: 'Non. Il rapporte le statut et les dates des agréments tels que les énoncent le registre et les documents, et les preuves de conformité comme présentes ou absentes. La nécessité d’un agrément, et ce qu’implique une expiration, relèvent de vos conseils juridiques.' },
      { q: 'D’où viennent les seuils ?', a: 'Uniquement des documents eux-mêmes, comme la clause de surveillance de l’accord de partenariat. Sans seuil stipulé, les taux sont présentés tels que calculés et rien n’est comparé.' },
    ],
  },
  healthcare: {
    headline: 'Contrôlez les encaissements et les autorisations avant d’acheter le cabinet.',
    subhead:
      'Les deals de prestataires de soins se valorisent sur des encaissements qui dépendent des contrats avec les payeurs, du comportement des refus et du maintien des autorisations des praticiens. Pactlab recalcule les encaissements, les refus et le mix payeurs à partir des relevés de remboursement, confronte la présentation à ces chiffres, lit l’autorisation de chaque praticien et contrôle les documents, les dates et l’arithmétique, jamais la qualité des soins.',
    illustrationAlt: 'Illustration d’un cabinet, d’une ligne de battement de cœur et d’une check-list de facturation.',
    pains: [
      { title: 'Un taux de refus en baisse selon la présentation', body: 'Les relevés de remboursement montrent des refus en hausse trois années de suite, et les passages en perte avec eux.' },
      { title: 'Une autorisation expirée sans bruit', body: 'Le registre indique active ; l’ordre indique expirée, et le praticien a continué à facturer.' },
      { title: 'Un praticien qui est l’entreprise', body: 'Un tiers des encaissements provient d’un praticien, sans clause de non-concurrence au dossier.' },
    ],
    walkthrough: [
      { text: 'Les relevés de remboursement par payeur, les encaissements par praticien, l’effectif, les registres des autorisations et des contrats avec les payeurs et le compte de résultat par année arrivent en imports ; la présentation, les vérifications d’autorisation, le tableau des clauses de non-concurrence, les audits et les contrats sont lus avec leur source.' },
      { text: 'Des contrôles déterministes rédigent les affirmations contredites, la hausse des refus, la dérive du mix payeurs, les autorisations expirées, la concentration des praticiens, les contrats avec les payeurs arrivant à échéance et les coûts qui progressent plus vite que les revenus, chacun cité aux lignes ou à la page.' },
      { text: 'Un réviseur désigné accepte, rejette ou demande des justificatifs pour chaque constat ; rien n’est décidé par le logiciel.' },
      { text: 'Des scénarios de DCF, avec un multiple d’ARR pour la healthtech, et les constats acceptés sur le pont de prix d’acquisition ; le mix payeurs et les tarifs comme sensibilités de scénario.' },
      { text: 'Une autorisation expirée chiffrée en séquestre ou en garantie d’indemnisation spécifique, ou sa restauration en condition suspensive ; une retenue de rétention pour un praticien sans clause de non-concurrence ; chacun remontant à sa source.' },
    ],
    findings: [
      { title: 'Le taux de refus augmente trois années de suite ; la présentation le dit en baisse', evidence: 'Actes refusés ÷ actes traités tirés des relevés de remboursement, face à la présentation', term: 'Une décote sur les encaissements que suppose le prix' },
      { title: 'Deux praticiens encaissent après l’expiration de leur autorisation', evidence: 'L’échéance de la pièce de vérification face au registre et à l’export des encaissements', term: 'Restauration en condition suspensive, ou un séquestre' },
      { title: 'Un praticien porte 31 % des encaissements, sans clause de non-concurrence au dossier', evidence: 'Encaissements par praticien face au tableau des clauses de non-concurrence', term: 'Une retenue de rétention ou un earn-out' },
    ],
    deliverables: [
      { title: 'Des encaissements traçables', body: 'Encaissements, refus, délai d’encaissement et mix payeurs par année, avec les lignes derrière chaque chiffre.' },
      { title: 'Un registre des autorisations contrôlé', body: 'L’autorisation et l’échéance de chaque praticien, tirées du registre et des pièces de vérification.' },
      { title: 'Le compte de résultat sur toutes les années', body: 'Revenus, marges et passages en perte liés aux refus, personnel soignant, fournitures et coûts de facturation rapportés aux revenus, année par année.' },
    ],
    faq: [
      { q: 'Cela implique-t-il des données de patients ?', a: 'Non. Le pack lit des relevés de remboursement au niveau des payeurs et des encaissements au niveau des praticiens, par référence pseudonyme, jamais un patient, une ligne d’acte ou un diagnostic. Les données des praticiens restent dans du code déterministe et ne sont jamais envoyées à un modèle.' },
      { q: 'Juge-t-il la qualité des soins, ou la licéité de la facturation ou des adressages ?', a: 'Non. Il contrôle les documents, les dates et l’arithmétique : le statut et l’échéance des autorisations tels que les énoncent le registre et les pièces de vérification, et les preuves de conformité comme présentes ou absentes. Le jugement clinique et juridique revient à vos médecins et à vos conseils.' },
      { q: 'Quelles preuves le pack santé lit-il ?', a: 'Les relevés de remboursement ou exports de facturation par payeur, les encaissements par praticien, l’effectif, les registres des autorisations et des contrats avec les payeurs et le compte de résultat par année, ainsi que la présentation, les vérifications d’autorisation, le tableau des clauses de non-concurrence et de rétention, les audits de codage, l’analyse de risques HIPAA et les contrats. Chaque constat cite les lignes ou la page sur lesquelles il repose.' },
      { q: 'Couvre-t-il les cibles logicielles healthtech ?', a: 'Oui. Une cible healthtech passe aussi par la due diligence logicielle, de sorte que les constats sur les revenus, le code et les contrats côtoient ceux sur le prestataire de soins.' },
    ],
  },
  'telecom-media': {
    headline: 'Les activités d’abonnement se valorisent sur des affirmations. Confrontez-les à la facturation.',
    subhead:
      'Le churn, l’ARPU et les contrats dont dépendent les contenus et la distribution déterminent ce que vaut une entreprise de télécoms ou de médias. Pactlab lit les exports de facturation, le registre des droits, les relevés et les contrats que vous fournissez, recalcule les chiffres d’abonnés et y confronte la présentation et les dates : documents, dates et arithmétique, jamais un jugement sur les contenus ou le marché.',
    illustrationAlt: 'Illustration d’une tour de diffusion, d’un lecteur vidéo et d’une rangée d’abonnés.',
    pains: [
      { title: 'Un churn que la facturation contredit', body: 'La présentation annonce 0,9 % par mois ; les résiliations rapportées aux abonnés en début de période dans l’export de facturation donnent 1,5 %.' },
      { title: 'Un contrat qui prend fin juste après le closing', body: 'Le plus gros contrat d’affiliation expire au bout de neuf mois, et le registre indique 2028.' },
      { title: 'Un annonceur qui porte l’activité', body: 'Un tiers des revenus publicitaires provient d’une seule contrepartie.' },
    ],
    walkthrough: [
      { text: 'Les abonnés par mois et les mouvements d’abonnés du système de facturation, le registre des droits et de la distribution, les revenus publicitaires et d’affiliation par contrepartie, les investissements et le compte de résultat par année arrivent en imports ; le dossier de KPI, la présentation investisseurs et les contrats sont lus avec leur source. Les abonnés n’apparaissent que comme des nombres ; une absence est présentée comme une absence.' },
      { text: 'Des contrôles déterministes marquent les abonnés, le churn et l’ARPU de la présentation comme vérifiés, contredits ou non vérifiés, lisent la date de fin de chaque contrat face au closing attendu, mesurent les revenus publicitaires et d’affiliation par contrepartie, rapportent le coût des contenus par abonné et les investissements à l’ARPU par année, et conservent les contrôles déclaré face à facturé et par région, chacun cité aux lignes ou à la page.' },
      { text: 'Un réviseur désigné accepte, rejette ou demande des justificatifs pour chaque constat ; rien n’est décidé par le logiciel.' },
      { text: 'Les méthodes d’évaluation s’appliquent inchangées, avec le churn et l’ARPU recalculés comme paramètres de scénario et les expositions que le réviseur chiffre sur le pont de prix d’acquisition.' },
      { text: 'Un renouvellement en condition suspensive, des ajustements de prix liés à la base facturée et des conditions liées aux constats.' },
    ],
    findings: [
      { title: 'Churn de 0,9 % dans la présentation ; 1,5 % dans l’export de facturation', evidence: 'Résiliations ÷ abonnés en début de période, douze derniers mois', term: 'Le churn recalculé dans les scénarios' },
      { title: 'Le plus gros contrat d’affiliation prend fin neuf mois après le closing', evidence: 'La date de fin du contrat lui-même face au closing annoncé', term: 'Un renouvellement en condition suspensive, ou un ajustement de prix' },
      { title: 'Un annonceur représente 34 % des revenus publicitaires', evidence: 'Relevés publicitaires par contrepartie', term: 'Les revenus à risque dans les scénarios' },
      { title: 'Le coût des contenus par abonné augmente alors que l’ARPU stagne', evidence: 'Le compte de résultat par année rapporté aux mois-abonnés de l’export de facturation', term: 'La marge de la dernière année dans les scénarios' },
    ],
    deliverables: [
      { title: 'Des chiffres d’abonnés défendables', body: 'Abonnés, churn et ARPU tirés des exports de facturation, face à ce que dit la présentation.' },
      { title: 'Un calendrier des droits face au closing', body: 'La date de fin et le renouvellement de chaque contrat, cités à partir du contrat ou présentés comme ceux du registre.' },
      { title: 'Qui porte les revenus', body: 'Par région, par annonceur et par distributeur, avec les lignes derrière chaque part.' },
    ],
    faq: [
      { q: 'Que lit le pack télécoms et médias ?', a: 'Les abonnés par mois et les mouvements d’abonnés du système de facturation ou du CRM, le registre des droits et de la distribution, les revenus publicitaires et d’affiliation par contrepartie, les investissements et le compte de résultat par année, ainsi que le dossier de KPI, la présentation investisseurs et les contrats. Il contrôle ce qui est fourni et présente ce qui manque comme manquant.' },
      { q: 'Comment le churn et l’ARPU sont-ils mesurés ?', a: 'Le churn correspond aux résiliations rapportées aux abonnés en début de période, et l’ARPU au revenu de service rapporté à la moyenne des abonnés en début et en fin de période, sur les douze derniers mois et pour chaque année civile entièrement couverte par l’export, jamais une année partielle extrapolée.' },
      { q: 'Pactlab juge-t-il les contenus ou le marché ?', a: 'Non. Il rapporte ce qu’énoncent les exports et les documents, les dates qu’ils donnent et l’arithmétique. Savoir si une contrepartie renouvellera, ou si un programme gardera son public, revient aux personnes qui décident.' },
      { q: 'Comment les constats atteignent-ils le deal ?', a: 'Comme paramètres de scénario et ajustements dans l’évaluation, et comme conditions suspensives ou ajustements de prix dans les conditions, chacun lié à son constat et accepté par une personne.' },
    ],
  },
  'professional-services': {
    headline: 'Les sociétés de services se valorisent sur les personnes dont dépendent les honoraires.',
    subhead:
      'L’utilisation, la réalisation et la part du portefeuille qui partirait si deux associés s’en allaient déterminent ce que vaut une société de services. Pactlab lit les exports temps et facturation, les balances âgées et le registre des clauses restrictives que vous fournissez, recalcule l’économie des collaborateurs facturables et la confronte à la présentation : documents et arithmétique, jamais une évaluation d’une personne.',
    illustrationAlt: 'Illustration d’une mallette, d’un graphique d’utilisation et d’une petite équipe présentée de façon agrégée.',
    pains: [
      { title: 'Un client au-dessus du plafond', body: 'La présentation affirme qu’aucun client ne dépasse 15 % des honoraires ; l’export de facturation indique 27 % pour le plus gros.' },
      { title: 'Une réalisation qui recule chaque année', body: 'Chaque heure se facture moins cher que l’année précédente, et une seule année le masque.' },
      { title: 'Des apporteurs d’affaires libres de partir', body: 'Les associés qui portent le portefeuille n’ont aucune clause de non-sollicitation au dossier.' },
    ],
    walkthrough: [
      { text: 'Le temps et la facturation par client et par collaborateur, les feuilles de temps et les effectifs en agrégé, les balances âgées des encours et des créances et le compte de résultat par année arrivent en imports ; le registre des clauses restrictives, les contrats clients et le mémorandum sont lus avec leur source. Les collaborateurs n’apparaissent que par référence pseudonyme ; une absence est présentée comme une absence.' },
      { text: 'Des contrôles déterministes marquent les plafonds clients et associés de la présentation comme vérifiés, contredits ou non vérifiés, lisent la réalisation par année et rapprochent les honoraires du compte de résultat, rédigent un apporteur d’affaires sans clause au dossier, une dérive d’ancienneté chiffrée dans le besoin en fonds de roulement, une utilisation inférieure au niveau déclaré et la part récurrente, chacun cité aux lignes ou à la page.' },
      { text: 'Un réviseur désigné accepte, rejette ou demande des justificatifs pour chaque constat ; rien n’est décidé par le logiciel, et aucune personne n’est évaluée.' },
      { text: 'Les méthodes d’évaluation s’appliquent inchangées, avec la réalisation et la concentration comme paramètres de scénario et la dérive d’ancienneté sur le pont de prix d’acquisition.' },
      { text: 'Des clauses signées en condition suspensive, des retenues de rétention ou des earn-outs liés au maintien du portefeuille, et des ajustements de prix liés aux constats.' },
    ],
    findings: [
      { title: 'Le premier client représente 27 % des honoraires ; la présentation affirme qu’aucun ne dépasse 15 %', evidence: 'Honoraires par client tirés de l’export de facturation face au mémorandum', term: 'La concentration recalculée dans les scénarios' },
      { title: 'Réalisation en baisse sur trois ans', evidence: 'Honoraires face à la valeur standard, année par année', term: 'La réalisation de la dernière année dans les scénarios' },
      { title: 'Deux apporteurs d’affaires sans clause de non-sollicitation au dossier', evidence: 'Portefeuilles des associés face au registre des clauses restrictives', term: 'Des clauses signées au closing, ou une retenue de rétention' },
      { title: 'Les encours de plus de 90 jours ont doublé en un an', evidence: 'Les balances âgées de clôture', term: 'Une réduction du besoin en fonds de roulement imputée sur le prix' },
    ],
    deliverables: [
      { title: 'L’économie des collaborateurs à partir des exports', body: 'Utilisation, réalisation et recouvrement avec les lignes qui les sous-tendent, rapprochés du compte de résultat.' },
      { title: 'De qui dépendent les honoraires', body: 'Les honoraires par client et par portefeuille d’associé, face aux plafonds qu’annonce la présentation.' },
      { title: 'Un registre des clauses restrictives fiable', body: 'La couverture de chaque apporteur d’affaires, citée à partir du document, ou présentée comme manquante.' },
    ],
    faq: [
      { q: 'Que lit le pack services ?', a: 'Les exports temps et facturation par mois, client, mission et collaborateur ; les synthèses de feuilles de temps et les mouvements d’effectifs en agrégé ; les balances âgées des encours et des créances ; le compte de résultat par année ; et le registre des clauses restrictives, les contrats clients et le mémorandum d’information. Il contrôle ce qui est fourni et présente ce qui manque comme manquant.' },
      { q: 'Comment les données personnelles sont-elles traitées ?', a: 'Les collaborateurs n’apparaissent que par référence pseudonyme, jamais un nom, un e-mail ou une rémunération, et rien les concernant n’atteint un modèle. Le pack rapporte des documents, une couverture et de l’arithmétique ; il ne classe ni n’évalue jamais une personne, et ne dit jamais si une clause est opposable.' },
      { q: 'Comment la réalisation est-elle mesurée ?', a: 'Les honoraires facturés rapportés à la valeur standard du temps passé, pour chaque année civile entièrement couverte par l’export, jamais une année partielle extrapolée. Les honoraires sont rapprochés du compte de résultat importé, année par année.' },
      { q: 'Comment les constats atteignent-ils le deal ?', a: 'Comme paramètres de scénario et ajustements dans l’évaluation, et comme clauses au closing, retenues de rétention, earn-outs ou ajustements de prix dans les conditions, chacun lié à son constat et accepté par une personne.' },
    ],
  },
  'pharma-biotech': {
    headline: 'Les deals pharma se valorisent sur des affirmations. Confrontez-les aux dépôts.',
    subhead:
      'Un pipeline et un portefeuille de brevets portent le prix, et les défaillances vérifiables sont des défauts de cohérence : une phase que contredit la fiche du registre, une falaise de brevets que personne n’a chiffrée, un jalon absent du modèle. Pactlab lit les fiches de registre, la correspondance, les titres de brevet et les accords que vous fournissez et les confronte aux affirmations du vendeur : documents, dates et cohérence, jamais un avis sur la science.',
    illustrationAlt: 'Illustration d’une double hélice d’ADN, d’une gélule et d’un document de brevet avec un calendrier.',
    pains: [
      { title: 'Une phase que les dépôts ne justifient pas', body: 'La présentation annonce la phase 2 ; la fiche de registre fournie indique la phase 1.' },
      { title: 'Une falaise de brevets pendant la détention', body: 'Le brevet clé expire un an et demi après le closing, et le prix suppose le contraire.' },
      { title: 'Un jalon absent du modèle', body: 'L’accord de licence prévoit un paiement au démarrage de la prochaine phase ; le modèle du vendeur ne l’intègre pas.' },
    ],
    walkthrough: [
      { text: 'Le tableau du pipeline, les fiches du registre des essais, le tableau des brevets, le modèle des obligations, l’effectif R&D et le compte de résultat par année arrivent en imports ; la correspondance réglementaire, les titres de brevet, les accords de licence et d’approvisionnement et la présentation sont lus avec leur source.' },
      { text: 'Des contrôles déterministes marquent chaque affirmation de phase, de statut et de résultats comme vérifiée, contredite ou non vérifiée, rédigent une falaise de brevets pendant la détention, une obligation absente du modèle ou sous-estimée, une fabrication à source unique, une concentration sur des scientifiques clés et une R&D stable face à un calendrier avancé, chacun cité aux lignes ou à la page.' },
      { text: 'Un réviseur désigné accepte, rejette ou demande des justificatifs pour chaque constat ; rien n’est décidé par le logiciel, et rien ne juge l’efficacité, l’approbabilité ou la conception des essais.' },
      { text: 'Des scénarios de DCF, avec les constats acceptés sur le pont de prix d’acquisition : la falaise de brevets chiffrée sur les revenus du produit, le jalon omis au montant stipulé par l’accord.' },
      { text: 'Jalons et paiements conditionnels, une clause de continuité d’approvisionnement ou un dispositif de rétention, chacun remontant à sa source.' },
    ],
    findings: [
      { title: 'L’actif principal est annoncé en phase 2 ; la fiche de registre indique la phase 1', evidence: 'Le tableau du pipeline face à la fiche du registre des essais et au compte rendu de l’autorité', term: 'Un scénario plus tardif et plus lent' },
      { title: 'Le brevet clé expire 18 mois après le closing', evidence: 'L’échéance du titre de brevet face à la date de closing et à la détention', term: 'Une réduction de prix sur les revenus à risque' },
      { title: 'Un jalon dû au démarrage de la prochaine phase manque au modèle du vendeur', evidence: 'La clause de l’accord de licence face au modèle des obligations', term: 'Le jalon déduit du prix, ou un paiement à la charge du vendeur' },
      { title: 'Les dépenses de R&D stagnent alors que le calendrier est avancé', evidence: 'La R&D sur chaque année importée du compte de résultat face aux nouvelles dates de la présentation', term: 'Les dates plus tardives ou la R&D supplémentaire dans les scénarios' },
    ],
    deliverables: [
      { title: 'Un registre des affirmations sur le pipeline', body: 'Chaque phase et date de résultats annoncée, vérifiée, contredite ou non vérifiée, avec le dépôt qui la sous-tend.' },
      { title: 'Le portefeuille de brevets face à la détention', body: 'La première falaise de chaque produit, le titre qui la date et les revenus qui en dépendent.' },
      { title: 'Les obligations que le modèle doit intégrer', body: 'Chaque jalon, redevance et frais stipulé par les accords, et si le modèle du vendeur l’intègre.' },
    ],
    faq: [
      { q: 'Quelles preuves le pack lit-il ?', a: 'Le tableau du pipeline, les fiches du registre des essais fournies par le vendeur, le tableau des brevets et les titres de brevet, les accords de licence et d’approvisionnement, le modèle du vendeur de ce qu’il doit, un effectif R&D par référence pseudonyme, la correspondance réglementaire et le compte de résultat par année. Pactlab ne consulte pas lui-même les registres ; il contrôle ce qui est fourni.' },
      { q: 'Juge-t-il la science ou les chances d’approbation ?', a: 'Non. Il contrôle les documents, les dates et la cohérence : une phase annoncée face au dépôt, une échéance face à la détention, un paiement face à l’accord. L’efficacité, l’approbabilité et la conception des essais relèvent de vos conseillers scientifiques et réglementaires.' },
      { q: 'Comment les falaises de brevets et les obligations sont-elles chiffrées ?', a: 'Une falaise pendant la détention est chiffrée sur les revenus facturés du produit qu’elle protège : en bas de fourchette une année de ces revenus, en haut une année par année de détention restante, avant l’érosion que fixe votre réviseur. Un jalon omis est chiffré au montant stipulé par l’accord. Une personne accepte chaque prix.' },
      { q: 'Comment les données personnelles sont-elles traitées ?', a: 'Les scientifiques n’apparaissent que comme des références pseudonymes et des effectifs ; leurs chiffres restent dans du code déterministe et ne sont jamais envoyés à un modèle. Les documents RH ne sont jamais lus par les contrôles.' },
    ],
  },
  'ecommerce-dtc': {
    headline: 'Les marques se valorisent sur la valeur vie client. Recalculez-la sur la contribution.',
    subhead:
      'Les deals DTC se valorisent sur des affirmations de LTV et sur des revenus qui peuvent transiter par des comptes que le vendeur détient personnellement. Pactlab lit les exports de la boutique, des marketplaces et des plateformes publicitaires ainsi que les documents de compte que vous fournissez, recalcule l’économie unitaire sur la base de la contribution et la confronte à la présentation : uniquement des exports et des documents, jamais de scraping.',
    illustrationAlt: 'Illustration d’une vitrine, d’un sac de courses avec une flèche de rachat et des rachats par cohorte.',
    pains: [
      { title: 'Une valeur vie client calculée sur le chiffre d’affaires brut', body: 'La LTV de la présentation compte les ventes brutes ; sur la contribution, après coût des marchandises, logistique et frais, elle n’en est qu’une fraction.' },
      { title: 'Le compte marketplace appartient au fondateur', body: 'L’essentiel des revenus transite par un compte vendeur enregistré au nom personnel du fondateur, pas de la société.' },
      { title: 'Un stock qui ne se vendra pas', body: 'Un cinquième de la valeur des stocks a été reçu il y a plus de six mois.' },
    ],
    walkthrough: [
      { text: 'Les commandes par canal et par compte, les cohortes, les dépenses publicitaires, le rapport de stock et le compte de résultat par année arrivent en imports ; les documents de compte des plateformes, les conditions des marketplaces et la présentation investisseurs sont lus avec leur source. L’absence d’un export est présentée comme une absence.' },
      { text: 'Des contrôles déterministes marquent la LTV et le CAC de la présentation comme vérifiés, contredits ou non vérifiés, rapprochent les revenus par canal du compte de résultat par année, rédigent un compte significatif détenu personnellement, un stock ancien chiffré en dépréciation, un taux de retour en hausse et un coût d’acquisition croissant avec une contribution qui se réduit au fil des années, chacun cité aux lignes ou à la page.' },
      { text: 'Un réviseur désigné accepte, rejette ou demande des justificatifs pour chaque constat ; rien n’est décidé par le logiciel.' },
      { text: 'Les méthodes d’évaluation s’appliquent inchangées, avec l’économie unitaire sur la contribution comme paramètres de scénario et la dépréciation du stock ancien sur le pont de prix d’acquisition.' },
      { text: 'Le transfert du compte à la société en condition suspensive, un séquestre jusqu’à sa réalisation et des ajustements de prix liés à l’économie unitaire.' },
    ],
    findings: [
      { title: 'La valeur vie client de la présentation est calculée sur le chiffre d’affaires brut', evidence: 'La présentation face aux cohortes, aux commandes et à la contribution tirées des exports', term: 'La LTV sur la contribution dans les scénarios' },
      { title: '64 % des revenus transitent par un compte marketplace détenu personnellement par le fondateur', evidence: 'Commandes par compte face aux documents de compte de la plateforme', term: 'Transfert en condition suspensive, séquestre jusqu’à sa réalisation' },
      { title: '22 % du stock a plus de 180 jours', evidence: 'Le rapport de stock, vieilli à sa date', term: 'Une dépréciation déduite du prix' },
      { title: 'Coût d’acquisition en hausse et contribution en baisse sur trois ans', evidence: 'Commandes par année face à la publicité de chaque année importée du compte de résultat', term: 'L’économie unitaire de la dernière année dans les scénarios' },
    ],
    deliverables: [
      { title: 'L’économie unitaire à partir des exports', body: 'La valeur vie client sur la contribution et le coût d’acquisition payant, avec les lignes qui les sous-tendent.' },
      { title: 'La dépendance aux plateformes', body: 'La part des revenus de chaque compte et la personne au nom de laquelle il est enregistré, citées à partir du document.' },
      { title: 'Des revenus par canal qui concordent', body: 'Les ventes nettes par canal, rapprochées du compte de résultat année par année.' },
    ],
    faq: [
      { q: 'Que lit le pack e-commerce ?', a: 'Les exports de commandes de la boutique et des marketplaces par mois, canal et compte, les rachats par cohorte, les exports de dépenses des plateformes publicitaires, le rapport de stock, le compte de résultat par année, ainsi que les documents de compte des plateformes, les conditions des marketplaces et la présentation investisseurs. Pactlab ne se connecte jamais à une marketplace, une boutique ou une plateforme publicitaire et n’en extrait jamais rien par scraping ; il contrôle ce qui est fourni et présente ce qui manque comme manquant.' },
      { q: 'Comment la valeur vie client est-elle recalculée ?', a: 'Le nombre de commandes par client sur les douze premiers mois provient des cohortes ; la contribution par commande provient des commandes des consommateurs, après remises, retours, coût des marchandises, logistique et frais de canal. Le produit est confronté au chiffre de la présentation ; si la présentation correspond aux mêmes commandes en ventes brutes, le constat le dit.' },
      { q: 'Cela change-t-il la façon dont la marque est évaluée ?', a: 'Non. Les méthodes d’évaluation sont les mêmes ; les constats d’économie unitaire les alimentent comme paramètres et ajustements, et le stock ancien est chiffré en dépréciation qu’une personne accepte.' },
      { q: 'Que se passe-t-il quand un compte est détenu personnellement ?', a: 'Un compte de boutique, de marketplace ou publicitaire qui porte une part significative des revenus et qui est enregistré au nom d’une personne physique est rédigé pour revue, avec sa part et la phrase du document. Son transfert à la société est une condition suspensive que le réviseur peut chiffrer en séquestre.' },
    ],
  },
  multifamily: {
    headline: 'Payez pour l’état locatif, pas pour le mémorandum d’offre.',
    subhead:
      'La valeur d’un immeuble résidentiel, c’est le résultat net d’exploitation divisé par un taux de capitalisation. Pactlab reconstruit le revenu à partir de l’état locatif et du T-12, contrôle l’état des logements et chiffre ce qu’il trouve.',
    illustrationAlt: 'Illustration d’un immeuble d’habitation, d’un état locatif et d’un graphique du résultat net d’exploitation.',
    pains: [
      { title: 'Un revenu qui n’existe que dans le mémorandum', body: 'Les loyers pro forma et les loyers en place sont des chiffres différents, et le prix est fixé sur l’un d’eux.' },
      { title: 'De l’entretien différé derrière chaque porte', body: 'Les inspections des logements racontent une autre histoire que les photos.' },
      { title: 'Des impayés dans quelques bâtiments', body: 'Un taux de recouvrement global peut masquer où se trouvent réellement les arriérés.' },
    ],
    walkthrough: [
      { text: 'L’état locatif, le T-12, les dossiers de baux, les rapports d’impayés, les factures de fluides et les inspections des logements sont connectés pour le deal et conservés avec leur source.' },
      { text: 'L’écart aux loyers du marché, l’entretien différé par logement et la concentration des impayés sont rédigés avec les lignes et les inspections qui les sous-tendent.' },
      { text: 'Un réviseur accepte le constat d’entretien avec sa fourchette de coûts et demande des justificatifs sur l’évolution des impayés.' },
      { text: 'Le résultat net d’exploitation et le taux de capitalisation tournent dans le moteur de scénarios ; les travaux par logement s’inscrivent comme remise en état.' },
      { text: 'L’entretien différé devient un ajustement de prix ou un séquestre pour travaux. Le potentiel d’écart aux loyers du marché est enregistré comme valeur confirmée, jamais ajouté au prix.' },
    ],
    findings: [
      { title: 'Entretien différé supérieur au budget de travaux', evidence: 'Inspections de l’état des logements face au plan d’investissement', term: 'Séquestre pour travaux ou ajustement de prix' },
      { title: 'Impayés concentrés dans un bâtiment', evidence: 'Rapports d’impayés rapprochés de l’état locatif', term: 'Engagement de recouvrement et scénario défavorable' },
      { title: 'Loyers en place inférieurs au marché sur l’ensemble du bien', evidence: 'État locatif face aux dossiers de baux en cours', term: 'Valeur confirmée dans le grand livre, pas prix payé' },
    ],
    deliverables: [
      { title: 'Un pont de revenus', body: 'Du mémorandum à l’état locatif, avec l’écart validé.' },
      { title: 'Un registre des travaux par logement', body: 'Chaque constat d’entretien accepté avec ses preuves et sa fourchette de coûts.' },
      { title: 'Des scénarios de NOI et de taux de capitalisation', body: 'Calculés à partir de paramètres enregistrés, pour que chaque variation de prix soit traçable.' },
    ],
    faq: [
      { q: 'Que lit le pack résidentiel collectif ?', a: 'L’état locatif et le T-12, les dossiers de baux, les rapports d’impayés, les factures de fluides et les inspections de l’état des logements. L’état locatif se transpose dans le même grand livre des revenus que Pactlab utilise pour les revenus récurrents.' },
      { q: 'L’écart aux loyers du marché augmente-t-il le prix que nous payons ?', a: 'Non. Le potentiel des loyers inférieurs au marché est enregistré comme valeur confirmée, une preuve qui soutient le prix, et jamais comme une raison de payer plus.' },
      { q: 'Comment les travaux sont-ils traités ?', a: 'L’entretien différé par logement est un constat chiffré. Une fois accepté par un réviseur, il devient une remise en état dans l’évaluation et un ajustement de prix ou un séquestre dans les conditions.' },
    ],
  },
  'commercial-property': {
    headline: 'Un immeuble vaut les baux qu’il abrite.',
    subhead:
      'Bureaux, commerces et locaux d’activité se valorisent sur les revenus locatifs et leur durée. Pactlab établit les synthèses des baux avec des citations exactes, cartographie les échéances et signale ce que contient l’historique environnemental et d’urbanisme.',
    illustrationAlt: 'Illustration d’un immeuble commercial, d’une frise des échéances de baux et d’un rapport environnemental.',
    pains: [
      { title: 'Deux locataires, l’essentiel du revenu', body: 'La concentration des locataires détermine la durabilité du revenu.' },
      { title: 'Des baux qui prennent fin pendant la détention', body: 'Une durée résiduelle solide sur le papier peut masquer un mur d’échéances proches.' },
      { title: 'Un rapport environnemental que personne n’a lu attentivement', body: 'Les constats de phase I et les limites d’urbanisme suivent l’actif.' },
    ],
    walkthrough: [
      { text: 'Synthèses des baux, état locatif, redditions de charges, diagnostics environnementaux de phase I et documents d’urbanisme.' },
      { text: 'Concentration des locataires, échéances proches face à la durée résiduelle moyenne, baux au-dessus et en dessous du marché et signaux environnementaux, chacun citant sa clause ou son rapport.' },
      { text: 'Les réviseurs tranchent chaque constat avec la clause du bail ou la page du rapport sous les yeux.' },
      { text: 'La durée résiduelle moyenne et l’échéancier sont des paramètres de scénario, avec une sensibilité au taux de capitalisation calculée de façon déterministe.' },
      { text: 'Ajustements de prix, réserves de commercialisation et garanties environnementales liés aux constats.' },
    ],
    findings: [
      { title: 'Le bail du locataire principal expire pendant la détention', evidence: 'Clauses d’échéance et de renouvellement citées à partir du bail', term: 'Réserve de commercialisation et scénario défavorable' },
      { title: 'Pollution identifiée dans le diagnostic de phase I', evidence: 'Diagnostic environnemental de phase I du site, cité à la page', term: 'Garantie environnementale ou séquestre' },
      { title: 'Charges refacturées inférieures aux dépenses', evidence: 'Redditions de charges face au compte d’exploitation', term: 'Ajustement du revenu dans l’évaluation' },
    ],
    deliverables: [
      { title: 'Des synthèses de baux citées', body: 'Chaque condition clé liée à la clause dont elle provient.' },
      { title: 'Un échéancier', body: 'Les échéances face à la durée résiduelle moyenne, dans l’évaluation plutôt qu’en annexe.' },
      { title: 'Une sensibilité au taux de capitalisation', body: 'L’effet d’une variation du taux de capitalisation sur le prix, à partir de paramètres enregistrés.' },
    ],
    faq: [
      { q: 'Quels types de biens le pack couvre-t-il ?', a: 'Bureaux, commerces et locaux d’activité, immeubles isolés et portefeuilles.' },
      { q: 'Comment les synthèses de baux sont-elles établies ?', a: 'Des modèles rédigent la synthèse avec des citations exactes du bail ; une clause introuvable est rejetée, et un réviseur désigné accepte chaque condition.' },
      { q: 'Comment les constats environnementaux atteignent-ils le deal ?', a: 'Un constat de phase I ou d’urbanisme accepté devient un risque chiffré, une garantie, un séquestre ou un ajustement de prix, lié à la page dont il provient.' },
    ],
  },
  hotels: {
    headline: 'Un hôtel est une activité d’exploitation sur un bien immobilier.',
    subhead:
      'Les revenus des chambres, les obligations envers l’enseigne et les travaux qu’elle exigera déterminent ce que vaut un hôtel. Pactlab lit l’historique d’exploitation et les contrats, et chiffre le plan de rénovation avant que vous ne signiez.',
    illustrationAlt: 'Illustration d’un hôtel, d’un graphique de RevPAR et d’un contrat d’enseigne.',
    pains: [
      { title: 'Un RevPAR lu sans le jeu concurrentiel', body: 'Une croissance inférieure à celle du marché est un déclin déguisé.' },
      { title: 'Un plan de rénovation de l’enseigne qui attend au closing', body: 'Les plans de rénovation peuvent tomber sur l’acheteur le jour du closing.' },
      { title: 'Une demande qui vit sur une saison', body: 'Une bonne année peut reposer sur quelques mois ou une seule source de demande.' },
    ],
    walkthrough: [
      { text: 'Rapports PMS et STR, contrats de franchise et d’enseigne, contrats de gestion, historique d’occupation, d’ADR et de RevPAR, et comptes de résultat de la restauration.' },
      { text: 'Travaux de PIP différés, charges et fenêtres de résiliation de la franchise, et saisonnalité de la demande, chacun citant sa source.' },
      { text: 'Les réviseurs tranchent chaque constat avec la clause du contrat ou les lignes d’exploitation sous les yeux.' },
      { text: 'Les tendances du RevPAR et de la marge GOP alimentent les scénarios ; les travaux du PIP s’inscrivent comme remise en état.' },
      { text: 'Les travaux du PIP comme ajustement de prix ou séquestre, et les accords de l’enseigne comme conditions suspensives.' },
    ],
    findings: [
      { title: 'PIP de l’enseigne exigé en cas de changement de propriétaire', evidence: 'Clause citée à partir du contrat de franchise', term: 'Ajustement de prix ou séquestre pour le PIP' },
      { title: 'Croissance du RevPAR inférieure au jeu concurrentiel', evidence: 'Rapports STR face à l’historique d’exploitation', term: 'Scénario défavorable dans l’évaluation' },
      { title: 'Contrat de gestion résiliable uniquement moyennant indemnité', evidence: 'Clause de résiliation citée à partir du contrat de gestion', term: 'Coût de résiliation dans le pont de prix d’acquisition' },
    ],
    deliverables: [
      { title: 'Tendances du RevPAR et des marges', body: 'À partir de l’historique d’exploitation, face au jeu concurrentiel.' },
      { title: 'Un registre des obligations envers l’enseigne', body: 'PIP, charges et fenêtres de résiliation, chacun avec sa clause.' },
      { title: 'Des conditions qui intègrent les travaux', body: 'Les coûts du PIP chiffrés dans le deal plutôt que découverts après.' },
    ],
    faq: [
      { q: 'Que lit le pack hôtellerie ?', a: 'Les rapports PMS et STR, les contrats de franchise et d’enseigne, les contrats de gestion, l’historique d’occupation, d’ADR et de RevPAR, et les comptes de résultat de la restauration.' },
      { q: 'Comment le plan de rénovation est-il chiffré ?', a: 'Comme un constat chiffré. Une fois accepté, les travaux du PIP sont une remise en état dans l’évaluation et un ajustement de prix ou un séquestre dans les conditions.' },
      { q: 'Couvre-t-il les hôtels indépendants ?', a: 'Oui. Sans enseigne, il n’y a pas de constats de franchise ; les constats d’exploitation, de demande et de contrat de gestion s’appliquent toujours.' },
    ],
  },
  'venture-raise': {
    headline: 'Abordez la due diligence en sachant ce que l’investisseur trouvera.',
    subhead:
      'Les investisseurs confrontent la présentation à la facturation, la table de capitalisation aux registres sociaux et la propriété intellectuelle aux contrats. Venture Raise effectue d’abord les mêmes contrôles pour le fondateur, modélise chaque offre concurrente et garde ce que vous trouvez de votre côté jusqu’à ce que vous choisissiez de le partager.',
    illustrationAlt: 'Illustration d’un indicateur de présentation confronté à la facturation, d’une table de capitalisation et de deux term sheets côte à côte.',
    pains: [
      { title: 'Un chiffre de la présentation que la facturation ne justifie pas', body: 'Un indicateur phare que contredit le premier contrôle de l’investisseur coûte plus de crédibilité que n’importe quel autre constat.' },
      { title: 'Des SAFE qui se convertissent en plus que prévu', body: 'Plafonds, décotes et une clause de la nation la plus favorisée oubliée déterminent quelle part de la société le tour prend réellement.' },
      { title: 'Une propriété intellectuelle encore détenue par un prestataire', body: 'Un seul contrat sans cession devient une condition suspensive.' },
    ],
    walkthrough: [
      { text: 'La facturation, la table de capitalisation, la trésorerie et le burn mensuels, les registres sociaux, les contrats de prestataires, le registre des SAFE et les term sheets que vous avez reçues.' },
      { text: 'L’ARR de la présentation est confronté à la facturation et sa piste de trésorerie à la trésorerie ; les SAFE, le pool et la chaîne de la propriété intellectuelle sont confrontés aux documents. Chaque chiffre de la présentation devient une affirmation : vérifiée, contredite ou non vérifiée.' },
      { text: 'Vous décidez de ce que signifie chaque constat et corrigez ce que vous pouvez avant qu’un investisseur ne le voie. Les points forts restent confidentiels jusqu’à ce que vous choisissiez de les montrer.' },
      { text: 'Chaque offre passe par le modèle du tour : prix par action, conversion des SAFE au plafond ou avec décote, remaniement du pool en actions et en pourcentage, et participation des fondateurs après le tour.' },
      { text: 'La préférence de liquidation et la composition du conseil sont expliquées en langage clair. Pactlab montre l’effet d’une condition ; la décision vous revient, avec vos conseils.' },
    ],
    findings: [
      { title: 'ARR de la présentation supérieur à l’ARR facturé', evidence: 'Lignes de facture face à l’indicateur phare de la présentation', term: 'Corriger la présentation avant le contrôle de l’investisseur' },
      { title: 'Un SAFE avec clause de la nation la plus favorisée reprend un plafond ultérieur plus bas', evidence: 'Table de capitalisation et registre des SAFE', term: 'Davantage d’actions de conversion dans chaque scénario' },
      { title: 'Contrat de prestataire sans cession de propriété intellectuelle', evidence: 'Le contrat dans la data room', term: 'Cession confirmative avant le closing' },
    ],
    deliverables: [
      { title: 'Un registre des affirmations', body: 'Chaque chiffre de la présentation avec ses preuves et son statut.' },
      { title: 'Les offres côte à côte', body: 'Les conditions de chaque investisseur et ce que détiennent les fondateurs après chacune.' },
      { title: 'Une vue investisseur', body: 'Des chiffres vérifiés et la data room, sans rien de confidentiel.' },
    ],
    faq: [
      { q: 'À qui s’adresse-t-il ?', a: 'Aux fondateurs qui lèvent des fonds en pré-amorçage, en amorçage ou en série A auprès de business angels, d’incubateurs et d’accélérateurs, ou de fonds de capital-risque : le fondateur est l’utilisateur de Pactlab.' },
      { q: 'Puis-je comparer plusieurs investisseurs ?', a: 'Oui. L’offre de chaque investisseur est une offre dans la même levée ; le modèle du tour s’exécute pour chacune et les présente côte à côte, sans les classer.' },
      { q: 'Donne-t-il des conseils juridiques ou financiers ?', a: 'Non. Il montre la mécanique et les conséquences de chaque condition et les preuves derrière chaque constat. Les décisions vous reviennent, avec vos conseils.' },
    ],
  },
  'multifamily-syndication': {
    headline: 'Confrontez l’offre au bien et au contrat.',
    subhead:
      'Une syndication, ce sont deux deals à la fois : le bien que le sponsor achète et l’offre à laquelle souscrivent les investisseurs. Pactlab passe le bien au crible avec le pack résidentiel collectif, lit le PPM et le contrat de société, recalcule la cascade et confronte chaque affirmation à ses preuves.',
    illustrationAlt: 'Illustration d’une résidence, d’un mémorandum d’offre et d’une cascade de distributions.',
    pains: [
      { title: 'Un TRI projeté que la cascade ne peut atteindre', body: 'La présentation annonce un rendement ; les propres conditions du contrat de société, appliquées aux propres revenus du bien, en produisent un autre.' },
      { title: 'Des frais que seul le contrat mentionne', body: 'Des frais prévus au contrat de société mais omis du résumé du PPM changent ce que conservent les investisseurs.' },
      { title: 'Un historique de performance sans rien derrière', body: 'Un deal antérieur décrit dans la présentation sans rendements réels au dossier est une affirmation, pas un historique.' },
    ],
    walkthrough: [
      { text: 'L’état locatif, le T-12 et les inspections passent par le pack résidentiel collectif ; le PPM, le contrat de société, la présentation et les dossiers des deals antérieurs du sponsor sont lus avec leur source.' },
      { text: 'Les frais, le rendement préférentiel et les paliers de promote sont proposés à partir des documents avec des citations exactes. La cascade est recalculée à partir des conditions confirmées, et chaque écart est rédigé en constat.' },
      { text: 'Le sponsor confirme ou corrige chaque condition extraite ; un réviseur accepte les constats et tranche chaque affirmation comme vérifiée, contredite ou non vérifiée.' },
      { text: 'Le bien est valorisé sur le NOI et le taux de capitalisation. Les rendements des investisseurs après rendement préférentiel et promote sont calculés sur des trajectoires défavorable, centrale et favorable, présentées comme des scénarios fondés sur des hypothèses énoncées.' },
      { text: 'Les défauts de l’offre sont corrigés dans les documents avant que les investisseurs ne les voient ; les constats sur le bien sont reportés dans le prix et les conditions avec le vendeur, derrière le mur.' },
    ],
    findings: [
      { title: 'TRI projeté supérieur à la cascade recalculée', evidence: 'Conditions du contrat de société appliquées à la trajectoire de revenus du T-12', term: 'Corriger le PPM et la présentation avant la levée' },
      { title: 'Frais du contrat de société absents du PPM', evidence: 'La clause de frais du contrat face au récapitulatif des frais du PPM', term: 'Présenter les frais dans le PPM' },
      { title: 'Affirmation sur un deal antérieur sans réalisations', evidence: 'La déclaration d’historique de la présentation face aux dossiers des deals antérieurs', term: 'Affirmation non vérifiée jusqu’à la fourniture des réalisations' },
    ],
    deliverables: [
      { title: 'Un registre des affirmations de l’offre', body: 'Chaque affirmation significative avec ses preuves et son statut.' },
      { title: 'Un contrôle de la cascade', body: 'Les rendements annoncés face aux rendements recalculés, avec les conventions écrites en toutes lettres.' },
      { title: 'Un tableau de l’historique', body: 'Les deals antérieurs, prévisions face aux réalisations, une absence étant présentée comme une absence.' },
    ],
    faq: [
      { q: 'En quoi est-ce différent du pack résidentiel collectif ?', a: 'Le pack résidentiel collectif couvre une cession entre deux parties. Une syndication y ajoute la levée : le sponsor passe le bien au crible, et l’offre est contrôlée au regard du bien, du contrat de société et de l’historique du sponsor. Les contrôles du bien sont ceux du pack résidentiel collectif, inchangés.' },
      { q: 'Pactlab vérifie-t-il l’accréditation ?', a: 'Non. Pactlab ne se prononce pas sur l’accréditation. Il suit le statut de chaque investisseur et la référence aux preuves du spécialiste qui l’a vérifiée.' },
      { q: 'S’agit-il de conseil juridique ou d’un service d’offre de titres ?', a: 'Non. C’est un appui à la due diligence : il organise les preuves et signale les lacunes aux parties et à leurs conseils. Il n’exerce aucune fonction d’offre de titres ni de courtier.' },
      { q: 'Le vendeur peut-il voir la levée ?', a: 'Non. L’offre est le propre côté du pacte du sponsor. Le vendeur ne voit jamais la levée, et les investisseurs ne voient jamais la négociation de l’acquisition.' },
    ],
  },
  'music-rights': {
    headline: 'Achetez les redevances que vous pouvez prouver.',
    subhead:
      'Un catalogue musical s’achète pour ses revenus de redevances, et la due diligence échoue de façon vérifiable : un tube sans cession, des répartitions qui totalisent 105 %, des cessions que les auteurs peuvent résilier pendant votre détention. Pactlab construit le registre à partir des relevés et des enregistrements, modélise les revenus et quantifie l’exposition à la résiliation.',
    illustrationAlt: 'Illustration d’un catalogue musical : des disques, un relevé de redevances et un registre des droits.',
    pains: [
      { title: 'Des revenus sans titre derrière', body: 'Une œuvre rapporte sur chaque relevé, mais rien dans la chaîne des droits ne montre comment le vendeur en est devenu propriétaire.' },
      { title: 'Des droits qui peuvent revenir à leurs auteurs', body: 'Des cessions consenties il y a des décennies deviennent résiliables en droit d’auteur américain, parfois au milieu de la détention.' },
      { title: 'Des revenus déjà dépensés', body: 'Une avance non recouvrée dans le grand livre de l’administrateur absorbe les redevances avant qu’elles n’atteignent le propriétaire.' },
    ],
    walkthrough: [
      { text: 'Le registre des œuvres, les répartitions des auteurs, la chaîne des droits et les relevés de redevances arrivent en imports ; relevés, split sheets, contrats et recherches de sûretés sont lus avec leur source.' },
      { text: 'Des contrôles déterministes rédigent les lacunes de titre, les écarts de répartition, l’exposition à la résiliation, la concentration, les avances non recouvrées, les sûretés non déclarées et les périodes de relevés manquantes, chacun avec sa citation.' },
      { text: 'Les entrées lues dans les documents sont confirmées ou corrigées par une personne avant de compter ; un réviseur accepte ou rejette chaque constat.' },
      { text: 'Un multiple de redevances sur les revenus nets récents, ajustés de l’érosion, avec l’exposition à la résiliation sur sa propre ligne du pont.' },
      { text: 'Les lacunes de titre deviennent une retenue, les revenus exposés une réduction de prix et une sûreté non déclarée une garantie d’indemnisation, chacun remontant à sa source.' },
    ],
    findings: [
      { title: 'Tube sans cession au dossier', evidence: 'La chaîne des droits face aux revenus de l’œuvre sur les relevés', term: 'Retenue sur le titre jusqu’à la production de la cession' },
      { title: 'Fenêtres de résiliation pendant la détention', evidence: 'Dates de cession face aux fenêtres des §203 et §304, sur les revenus récents', term: 'Réduction de prix sur la part exposée' },
      { title: 'Avance non recouvrée omise du résumé', evidence: 'Le grand livre de l’administrateur face au résumé du vendeur', term: 'Déduite du prix' },
    ],
    deliverables: [
      { title: 'Un registre des œuvres et des droits', body: 'Chaque œuvre avec ses revenus, ses répartitions, ses preuves de titre et sa fenêtre de résiliation.' },
      { title: 'Un modèle de revenus', body: 'Les revenus récents par source et par ancienneté du catalogue, avec l’ajustement d’érosion écrit en toutes lettres.' },
      { title: 'Un échéancier de l’exposition à la résiliation', body: 'Les cessions qui s’ouvrent pendant la détention, et les revenus qui en dépendent.' },
    ],
    faq: [
      { q: 'Pactlab me dit-il si le titre est valable ?', a: 'Non. C’est un appui à la due diligence, pas un conseil juridique : il organise les preuves et signale les lacunes de la chaîne des droits, pour vous et vos conseils. Il ne conclut pas à la validité du titre.' },
      { q: 'Décide-t-il si une notification de résiliation est valable ?', a: 'Non. Il calcule les fenêtres des §203 et §304 à partir des dates de cession, énonce ses conventions et quantifie les revenus qui en dépendent. Savoir si une notification a été ou pourrait être valablement signifiée relève de vos conseils.' },
      { q: 'D’où viennent les chiffres de revenus ?', a: 'Uniquement des relevés de redevances, des registres et des sources connectées. Une période de relevés manquante est présentée comme une lacune, jamais estimée.' },
      { q: 'La croissance fait-elle monter le prix ?', a: 'Non. Le multiple s’applique aux revenus ajustés de l’érosion : les baisses les réduisent et la croissance n’est jamais ajoutée. Une croissance vérifiée et un titre sans défaut sont enregistrés comme valeur confirmée.' },
    ],
  },
  'energy-generation': {
    headline: 'Chiffrez les passifs avant d’en hériter.',
    subhead:
      'Les centrales et les intérêts pétroliers et gaziers s’échangent sur des chaînes de titres, des données de production et de réserves, des contrats, et des obligations importantes et quantifiables. Pactlab construit le registre des actifs et des intérêts, confronte la production au rapport sur les réserves et chaque estimation de dépollution et de démantèlement à ce que le vendeur a comptabilisé.',
    illustrationAlt: 'Illustration d’une centrale, d’un site de forage et d’un tableau des passifs.',
    pains: [
      { title: 'Des obligations absentes du tableau', body: 'Un plan de fermeture d’un bassin de cendres se trouve dans la data room, et le tableau des passifs ne comptabilise rien à ce titre.' },
      { title: 'Des surfaces sous compte à rebours', body: 'Les baux non maintenus par la production expirent pendant la détention, et la valeur part avec eux.' },
      { title: 'Des quotes-parts qui ne tombent pas juste', body: 'Un division order verse une quote-part que la chaîne de redevances du bail ne justifie pas, et l’opérateur peut la récupérer.' },
    ],
    walkthrough: [
      { text: 'Les registres des centrales et des intérêts, les baux, la production et le tableau des passifs arrivent en imports ; les rapports sur les réserves, les avis sur les titres, les permis et les études sont lus avec leur source.' },
      { text: 'Des contrôles déterministes rédigent les passifs non comptabilisés, les insuffisances d’ARO, les écarts de déclin, les expirations de baux, les erreurs de quotes-parts, les falaises de contrats d’achat d’électricité, les ruptures de titre et les lacunes d’investissements de conformité, chacun avec sa citation.' },
      { text: 'Les entrées lues dans les rapports sont confirmées ou corrigées par une personne avant de compter ; un réviseur accepte ou rejette chaque constat.' },
      { text: 'Un DCF fondé sur les réserves pour les intérêts, et le $/kW plus la couverture contractuelle pour les centrales, via le pont standard.' },
      { text: 'La dépollution non comptabilisée devient une réduction de prix, l’insuffisance d’ARO un séquestre et une rupture de titre un délai de régularisation ou une retenue, chacun remontant à sa source.' },
    ],
    findings: [
      { title: 'Fermeture du bassin de cendres absente du tableau des passifs', evidence: 'L’estimation du plan de fermeture face au tableau du vendeur', term: 'Coût de dépollution déduit du prix' },
      { title: 'Obligation de démantèlement sous-comptabilisée de 40 %', evidence: 'L’étude de démantèlement face à l’ARO comptabilisée', term: 'Séquestre dimensionné sur l’insuffisance' },
      { title: 'Un quart des surfaces expire pendant la détention', evidence: 'Les durées et le statut de production du tableau des baux', term: 'Une décote sur la part exposée' },
    ],
    deliverables: [
      { title: 'Un registre des actifs et des intérêts', body: 'Chaque centrale et chaque intérêt avec son contrat, son bail, sa quote-part et sa production.' },
      { title: 'Une vue de la production et des réserves', body: 'Le déclin réel face à l’hypothèse du rapport ; les réserves telles que les énoncent les ingénieurs.' },
      { title: 'Un tableau des passifs contrôlé', body: 'Chaque estimation de dépollution et de démantèlement face à ce que le vendeur a comptabilisé, avec l’écart.' },
    ],
    faq: [
      { q: 'Pactlab estime-t-il les réserves ?', a: 'Non. Les chiffres de réserves proviennent uniquement du rapport d’ingénierie indépendant, cité comme tel et confirmé par une personne. Un rapport manquant est présenté comme une lacune, jamais comblé.' },
      { q: 'Me dit-il si le titre est valable ?', a: 'Non. C’est un appui à la due diligence, pas un conseil juridique, technique ou réglementaire : il organise les preuves et signale les ruptures de la chaîne des titres, pour vous et vos conseils. Il ne se prononce pas sur le titre.' },
      { q: 'D’où viennent les chiffres des passifs ?', a: 'Uniquement des rapports, des permis et du tableau du vendeur. Pactlab compare l’estimation des preuves à ce qui a été comptabilisé ; il n’estime jamais lui-même un passif.' },
      { q: 'Un titre sans défaut ou une ARO surcomptabilisée font-ils monter le prix ?', a: 'Non. Les marges de sécurité vérifiées sont enregistrées comme valeur confirmée, jamais comme une hausse de prix.' },
    ],
  },
  'startup-spv': {
    headline: 'Mettez l’argent en commun sur un tour dont les chiffres tiennent.',
    subhead:
      'Un organisateur de SPV répond devant chaque investisseur de deux choses : le tour de la start-up et les conditions propres du véhicule. Pactlab recalcule la table de capitalisation avec chaque SAFE converti, confronte chaque affirmation de la présentation à ses preuves, recalcule les frais et le carried à partir du contrat de société et ne publie aux investisseurs que ce que vous choisissez de partager.',
    illustrationAlt: 'Illustration d’un véhicule commun : plusieurs investisseurs réunis en une seule ligne sur la table de capitalisation d’une start-up.',
    pains: [
      { title: 'Une table de capitalisation qui ne tient pas', body: 'Le résumé du tour oublie que les SAFE se convertissent, si bien que le véhicule détient moins que ce qui a été annoncé à tous.' },
      { title: 'Des conditions qui ont changé en route', body: 'Le contrat de société prévoit 20 % de carried ; le résumé sur lequel les investisseurs ont souscrit indique 15 %.' },
      { title: 'Accords parallèles et éligibilité', body: 'Une side letter exonère un investisseur de ses frais, et un investisseur d’un véhicule 506(c) n’a jamais été vérifié.' },
    ],
    walkthrough: [
      { text: 'La facturation, la table de capitalisation et la trésorerie de la start-up arrivent en imports ; le résumé du tour, les SAFE, le contrat de société, le résumé investisseurs, les side letters et le Form D sont lus avec leur source.' },
      { text: 'Des contrôles déterministes rédigent les lacunes de la table de capitalisation et du calcul du tour, les affirmations contredites ou non étayées, les écarts de frais et de carried, les side letters non déclarées, les lacunes d’accréditation et un Form D manquant, chacun avec sa citation.' },
      { text: 'Un réviseur accepte ou rejette chaque constat ; le registre des affirmations présente chaque affirmation de la présentation comme vérifiée, contredite ou non vérifiée.' },
      { text: 'La valorisation pré-money du tour recalculée à partir du prix et du nombre d’actions, et des scénarios de rendement nets de frais sur les trajectoires de sortie que vous indiquez.' },
      { text: 'Ce que vous publiez aux investisseurs est un instantané figé et versionné : le registre des affirmations, le contrôle du tour, l’économie du véhicule et les scénarios, rien d’autre.' },
    ],
    findings: [
      { title: 'Les actions après le tour omettent la conversion des SAFE', evidence: 'La table de capitalisation avec chaque SAFE converti face au résumé du tour', term: 'Corriger le résumé avant l’engagement du véhicule' },
      { title: 'Le carried diffère du résumé investisseurs', evidence: 'Le contrat de société face au résumé des conditions', term: 'Corriger et informer de nouveau les investisseurs' },
      { title: 'Exonération de frais non déclarée dans une side letter', evidence: 'La side letter face à l’information donnée dans le résumé', term: 'La déclarer à chaque investisseur, ou la retirer' },
    ],
    deliverables: [
      { title: 'Une vérification du tour', body: 'Chaque conversion, la valorisation pré-money et le nombre d’actions après le tour recalculés, avec les droits au prorata par instrument.' },
      { title: 'Un contrôle de l’économie du véhicule', body: 'La charge de frais et le carried tirés du contrat de société, face à ce qui a été annoncé aux investisseurs.' },
      { title: 'Une vue investisseur publiée', body: 'Versionnée et figée ; les conditions d’un investisseur n’apparaissent jamais dans la vue d’un autre.' },
    ],
    faq: [
      { q: 'Pactlab vérifie-t-il l’accréditation ?', a: 'Non. L’accréditation est suivie, pas déterminée : vous consignez ce qu’a constaté un spécialiste de la vérification, avec un lien et une référence de preuve, et les contrôles signalent les lacunes pour vous et vos conseils.' },
      { q: 'S’agit-il de conseil juridique ou en valeurs mobilières ?', a: 'Non. C’est uniquement un appui à la due diligence : Pactlab n’exerce aucune fonction d’offre de titres, de courtier ni de conseiller en investissement. Il organise les preuves et signale les lacunes aux parties et à leurs conseils.' },
      { q: 'Les investisseurs peuvent-ils se voir entre eux ou voir les side letters ?', a: 'Non. Chaque investisseur voit sa propre place et la vue investisseur que vous publiez ; les side letters, les autres investisseurs et votre propre analyse n’y entrent jamais. La start-up ne voit jamais la liste des investisseurs.' },
      { q: 'Les scénarios de rendement sont-ils une prévision ?', a: 'Non. Ils sont calculés à partir des trajectoires de sortie que vous indiquez, nets des frais et du carried du véhicule, et présentés comme des scénarios, jamais comme une projection ou une promesse.' },
    ],
  },
  'small-clinics': {
    headline: 'Dans un petit cabinet, le risque tient à un propriétaire, un prescripteur et un bail.',
    subhead:
      'Les petits cabinets s’échangent sur les mêmes preuves que les grands groupes de soins, mais les risques s’y concentrent. Pactlab lit les encaissements, les autorisations et les contrats avec les payeurs comme le pack santé, puis recalcule ce que le propriétaire vendeur assure lui-même, d’où viennent les patients et combien de temps les locaux sont garantis : documents, dates et arithmétique, jamais un jugement clinique ou juridique.',
    illustrationAlt: 'Illustration d’un petit cabinet, d’un planning des praticiens en agrégé et d’un rapport de facturation.',
    pains: [
      { title: 'Le propriétaire est le service le plus rentable', body: 'Le propriétaire vendeur est le seul à assurer la ligne de service la plus rentable, et aucun praticien salarié ne la couvre.' },
      { title: 'Un prescripteur envoie la plupart des patients', body: 'Plus de la moitié des consultations viennent d’un hôpital ou d’un cabinet ; s’il cesse d’adresser des patients, le volume chute.' },
      { title: 'Un bail qui prend fin peu après le closing', body: 'Le bail arrive à son terme environ un an après le closing, sans option de renouvellement, et sa cession exige l’accord du bailleur.' },
    ],
    walkthrough: [
      { text: 'Les relevés de remboursement, les encaissements par praticien, les registres des autorisations et des contrats avec les payeurs, les lignes de service par praticien, les consultations par prescripteur, le volume de patients, le tableau des équipements et le compte de résultat par année arrivent en imports ; le mémorandum, le bail, les vérifications d’autorisation et les procédures sont lus avec leur source.' },
      { text: 'Des contrôles déterministes rédigent une ligne de service que seul le propriétaire assure, une part du propriétaire sans succession prévue au dossier, un prescripteur dominant, un bail court sans renouvellement, l’accord requis pour la cession, des coûts qui progressent plus vite que les revenus, un codage au-dessus de la procédure et des équipements vieillissants, chacun cité aux lignes ou à la page.' },
      { text: 'Un réviseur désigné accepte, rejette ou demande des justificatifs pour chaque constat ; rien n’est décidé par le logiciel.' },
      { text: 'Des scénarios de DCF, avec les constats acceptés sur le pont de prix d’acquisition : la dépendance au propriétaire et aux prescripteurs comme décotes chiffrées par le réviseur, le risque de déménagement et le remplacement des équipements comme ajustements.' },
      { text: 'Un accord de transition ou un earn-out lié à la ligne du propriétaire, l’accord du bailleur ou un nouveau bail en condition suspensive, chacun remontant à sa source.' },
    ],
    findings: [
      { title: '58 % des consultations viennent d’un seul prescripteur', evidence: 'Consultations par prescripteur, recalculées à partir de l’export de l’agenda', term: 'Une décote sur les consultations que suppose le prix' },
      { title: 'Le bail prend fin 14 mois après le closing sans option de renouvellement', evidence: 'La date de fin et la phrase de renouvellement du bail, face à la date de closing annoncée', term: 'Risque de déménagement ou de renégociation chiffré, ou un nouveau bail en condition suspensive' },
      { title: 'Le propriétaire vendeur est le seul à assurer la ligne de service la plus rentable', evidence: 'Lignes de service par praticien, avec les marges après coûts directs', term: 'Un accord de transition ou un earn-out' },
    ],
    deliverables: [
      { title: 'Le propriétaire, en chiffres', body: 'La part du propriétaire vendeur dans les consultations et les encaissements, et les lignes de service qu’il est seul à assurer.' },
      { title: 'Les locaux, lus dans le bail', body: 'La durée restante après le closing, le renouvellement et la cession, chacun avec sa phrase citée.' },
      { title: 'Le compte de résultat sur toutes les années', body: 'Revenus, marges, et coûts de fournitures, de laboratoire, de personnel soignant et de locaux rapportés aux revenus, année par année.' },
    ],
    faq: [
      { q: 'Quel lien avec le pack santé ?', a: 'C’est le pack santé à l’échelle de quelques sites. Les contrôles des relevés de remboursement, des autorisations et des contrats avec les payeurs s’y exécutent exactement comme là-bas ; le pack petits cabinets ajoute les contrôles sur le propriétaire exploitant, les prescripteurs et le bail.' },
      { q: 'Comment les données des praticiens sont-elles traitées ?', a: 'Les praticiens, y compris le propriétaire vendeur, n’apparaissent que sous des références pseudonymes comme P01. Leurs chiffres restent dans du code déterministe et ne sont jamais envoyés à un modèle.' },
      { q: 'Juge-t-il si un accord d’adressage ou un bail est licite ?', a: 'Non. Il rapporte des parts, des dates et les phrases que contiennent les documents. Le jugement clinique et juridique revient à vos médecins et à vos conseils.' },
      { q: 'Quels cabinets couvre-t-il ?', a: 'Les cabinets médicaux, dentaires, vétérinaires et de rééducation de quelques sites.' },
    ],
  },
  hospitals: {
    headline: 'Les résultats d’un hôpital ne valent que ce que vaut son mix payeurs.',
    subhead:
      'La concentration des payeurs, les autorisations et les médecins qui portent les lignes de service déterminent ce que vaut un hôpital. Le pack hôpitaux s’appuie sur le pack santé et lit les rapports de coûts, l’activité et le dossier d’accréditation.',
    illustrationAlt: 'Illustration d’un hôpital, d’un graphique du mix payeurs et d’un certificat d’accréditation.',
    pains: [
      { title: 'Un payeur derrière l’essentiel des résultats', body: 'Un changement de tarif chez un seul payeur modifie la valeur de l’hôpital.' },
      { title: 'Des autorisations qui pourraient ne pas se transférer proprement', body: 'Les autorisations et l’accréditation comportent des conditions qu’un changement de propriétaire peut déclencher.' },
      { title: 'Des lignes de service bâties sur quelques médecins', body: 'La dépendance aux médecins clés est un risque de revenus au closing.' },
    ],
    walkthrough: [
      { text: 'Mix payeurs, activité et activité quotidienne moyenne, rapports de coûts Medicare, dossiers d’autorisation et d’accréditation, et historique de responsabilité médicale.' },
      { text: 'Concentration des payeurs, lacunes d’autorisation et d’accréditation, et dépendance aux médecins clés, chacune citant son dossier, avec les données des médecins agrégées.' },
      { text: 'Les réviseurs cliniques, réglementaires et financiers décident dans un même circuit.' },
      { text: 'L’EBITDA ajusté du mix payeurs et les investissements réglementaires tournent dans le même moteur de scénarios.' },
      { text: 'Les autorisations réglementaires en conditions suspensives, garanties d’indemnisation et séquestres pour investissements liés aux constats.' },
    ],
    findings: [
      { title: 'Résultats concentrés sur un payeur', evidence: 'Mix payeurs tiré des rapports de coûts et des données de remboursement', term: 'EBITDA ajusté du mix payeurs dans l’évaluation' },
      { title: 'Condition d’accréditation déclenchée par le changement de propriétaire', evidence: 'Dossier d’accréditation, cité', term: 'Autorisation réglementaire en condition suspensive' },
      { title: 'La cardiologie dépend de deux médecins', evidence: 'Activité par ligne de service, agrégée', term: 'Dispositif de rétention dans le plan d’intégration' },
    ],
    deliverables: [
      { title: 'Une image du mix payeurs', body: 'Concentration et exposition tarifaire à partir des rapports de coûts.' },
      { title: 'Un registre des autorisations et des accréditations', body: 'Lacunes et conditions, chacune avec son dossier.' },
      { title: 'EBITDA ajusté du mix payeurs', body: 'Des résultats ajustés avec la base indiquée, et les investissements réglementaires comme remise en état.' },
    ],
    faq: [
      { q: 'Quel lien avec le pack santé ?', a: 'Il le prolonge. Les constats sur le remboursement et la réglementation du pack santé s’appliquent ; le pack hôpitaux ajoute les preuves d’activité, de rapports de coûts, d’autorisation et d’accréditation.' },
      { q: 'Cela implique-t-il des données de patients ?', a: 'Le pack travaille à partir de preuves agrégées sur les payeurs, l’activité, les rapports de coûts et les autorisations. Les données personnelles sensibles sont protégées et ne sont jamais envoyées à un modèle.' },
      { q: 'Comment les investissements réglementaires sont-ils traités ?', a: 'Comme un constat chiffré. Une fois accepté, il devient une remise en état dans l’évaluation et un séquestre ou un ajustement de prix dans les conditions.' },
    ],
  },
};
