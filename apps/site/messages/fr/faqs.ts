import type { Catalog } from '../../lib/i18n/catalog';

/** French FAQ pages (machine translation, T-171). */
export const faqs: Catalog['faqs'] = {
  acquirers: {
    audience: 'Acquéreurs',
    title: 'La due diligence assistée par l’IA pour les acquéreurs : questions et réponses',
    description: 'Comment fonctionne la due diligence assistée par l’IA sur une acquisition de logiciel ou de SaaS, ce que contrôle Pactlab et où une personne décide toujours.',
    items: [
      { q: 'Comment fonctionne la due diligence assistée par l’IA sur une acquisition de logiciel ?', a: 'Pactlab lit directement les preuves : l’export de facturation, le dépôt de code et son historique, l’outil de suivi des tickets et les documents de la data room. Il reconstruit les revenus récurrents à partir des données de facturation, lit les responsabilités et l’exposition aux licences dans le dépôt, et extrait les clauses contractuelles avec des citations à la page près. L’IA rédige des constats à partir de ces preuves ; un réviseur désigné les accepte, les rejette ou demande des justificatifs. Les calculs comme l’ARR, la rétention et l’évaluation sont du code déterministe, pas une production de modèle.' },
      { q: 'Que contrôle Pactlab qu’une data room ne contrôle pas ?', a: 'Une data room stocke des documents. Pactlab teste ce qu’ils affirment. Il compare ce que déclare la direction (ARR, churn, piste de trésorerie, effectifs) à ce que montrent les données de facturation, le dépôt et les contrats, et consigne chaque comparaison dans un registre des affirmations comme confirmée, contredite ou non vérifiée, avec la source des deux côtés.' },
      { q: 'L’IA peut-elle approuver un constat ou fixer le prix ?', a: 'Non. L’IA extrait, classe, compare et rédige. Un constat n’est accepté que lorsqu’une personne l’accepte, et un constat de l’IA sans citation résolue ne peut pas être accepté du tout. Les prix proviennent de scénarios d’évaluation fondés sur des hypothèses versionnées qu’une personne approuve.' },
      { q: 'Comment les constats modifient-ils l’évaluation ?', a: 'Un constat accepté et chiffré est relié à l’évaluation comme ajustement sur le pont de prix. Si le constat ou ses preuves changent, chaque scénario qui en dépend est signalé comme périmé jusqu’à son nouveau calcul, de sorte que le prix ne repose jamais en silence sur un constat qui a bougé.' },
      { q: 'Pactlab conserve-t-il le code source de la cible ?', a: 'Non. Le code est lu dans un espace de travail isolé et éphémère, détruit ensuite. Pactlab conserve les constats normalisés, les chemins de fichiers, les empreintes et les versions des outils, pas le code source.' },
      { q: 'Comment les données personnelles de la cible sont-elles traitées ?', a: 'Les personnes apparaissent par défaut sous forme agrégée. Les vues nominatives sont protégées, les lectures sont auditées, les petits groupes sont masqués, et les données RH, de rémunération et de contribution nominative ne sont jamais envoyées à un modèle d’IA.' },
      { q: 'Quels secteurs Pactlab couvre-t-il ?', a: 'Le logiciel et le SaaS constituent le cœur. Les packs sectoriels ajoutent les sources, les contrôles et les méthodes d’évaluation pour la fintech, les services de santé, les hôpitaux, les petits cabinets, les télécoms et médias, les services professionnels, la pharma et la biotech, l’e-commerce, le résidentiel collectif, l’immobilier commercial et l’hôtellerie. Chaque pack conserve les mêmes règles de revue et de citation.' },
    ],
    related: [{ label: 'Guide : mener la due diligence d’une acquisition SaaS' }, { label: 'Guide : la due diligence technique avec l’IA' }, { label: 'Les modules du produit (en anglais)' }],
  },
  founders: {
    audience: 'Fondateurs',
    title: 'Se préparer à l’examen des investisseurs : les questions des fondateurs',
    description: 'Comment un fondateur se prépare à la due diligence d’un fonds de capital-risque, ce que vérifient les investisseurs lors d’un tour d’amorçage, et comment Venture Raise de Pactlab vous aide à le voir en premier.',
    items: [
      { q: 'Comment me préparer à la due diligence d’un fonds de capital-risque ?', a: 'Confrontez vos propres affirmations à vos propres données avant qu’un investisseur ne le fasse. Les écarts habituels sont un ARR de présentation que la facturation ne justifie pas, une piste de trésorerie calculée sur un ancien burn, des SAFE qui se convertissent en une part plus grande de la société que prévu, et des travaux de prestataires sans cession de propriété intellectuelle. Venture Raise effectue ces contrôles sur votre export de facturation, votre table de capitalisation, vos comptes mensuels et vos documents, et présente chaque écart avec sa source.' },
      { q: 'Que vérifient les investisseurs lors d’un tour d’amorçage ?', a: 'En général : les revenus et leur qualité, le burn et la piste de trésorerie, la table de capitalisation et la conversion des SAFE et obligations en circulation, la propriété intellectuelle, le vesting et les options fiscales des fondateurs, les contrats clés et la composition du conseil après le tour. La check-list de préparation de Pactlab montre lesquels de ces points votre data room couvre déjà, pour un business angel comme pour un fonds de capital-risque.' },
      { q: 'Comment comparer les term sheets de plusieurs investisseurs ?', a: 'Saisissez chaque offre (pré-money, montant, objectif de pool, préférence de liquidation, sièges au conseil) dans l’onglet Raise. Pactlab modélise le tour pour chacune, y compris la conversion des SAFE et le remaniement du pool d’options, et présente côte à côte le prix par action et la participation des fondateurs.' },
      { q: 'Que voit un investisseur si je partage mon espace Pactlab ?', a: 'Uniquement la vue investisseur que vous choisissez de partager : les chiffres vérifiés et les documents que vous sélectionnez. Vos constats, votre analyse de la piste de trésorerie et les autres offres restent de votre côté.' },
      { q: 'Pactlab me dit-il combien vaut ma société ?', a: 'Il modélise ce que chaque offre signifie pour votre participation et contrôle les preuves derrière vos chiffres. La valorisation elle-même est ce dont vous convenez avec vos investisseurs ; Pactlab ne la fixe jamais.' },
    ],
    related: [{ label: 'Guide : se préparer à la due diligence d’un fonds de capital-risque' }, { label: 'Venture Raise' }],
  },
  advisors: {
    audience: 'Conseils en M&A',
    title: 'Pactlab pour les conseils en M&A : questions et réponses',
    description: 'Comment les conseils en M&A, les banquiers et les prestataires de due diligence utilisent Pactlab pour étayer leur travail et garder chaque chiffre traçable.',
    items: [
      { q: 'Comment Pactlab s’intègre-t-il au processus de due diligence d’un conseil ?', a: 'Pactlab est l’espace de travail où les preuves, les constats et l’évaluation restent reliés. Vous chargez l’export de facturation, le dépôt de code, l’outil de suivi des tickets et les documents du client ou de la cible ; Pactlab rédige des constats avec leurs citations ; vous les revoyez ; les constats acceptés alimentent les scénarios d’évaluation et les conditions du deal proposées.' },
      { q: 'Chaque chiffre d’un rapport peut-il être retracé ?', a: 'Oui. Chaque chiffre renvoie à la preuve dont il provient (une ligne de facturation, un commit, une page de document) et chaque constat accepté consigne qui l’a accepté et quand.' },
      { q: 'Les deals des clients restent-ils séparés ?', a: 'Oui. Chaque ligne d’un deal porte l’identité de son organisation et de son deal, et l’isolation est appliquée dans la base de données par la sécurité au niveau des lignes, pas seulement dans l’interface. Les contributeurs de la cible ne voient jamais les constats, l’évaluation ou les conditions de négociation réservés à l’acheteur, sauf s’ils sont explicitement partagés.' },
      { q: 'Quelles méthodes d’évaluation sont disponibles ?', a: 'Multiple d’ARR et flux de trésorerie actualisés pour le logiciel, plus les méthodes des packs là où le secteur l’exige : NOI et taux de capitalisation pour l’immobilier, EBITDA ajusté du mix payeurs pour les hôpitaux, et valorisation pré-money du tour pour les fondateurs qui lèvent des fonds. Chaque scénario enregistre ses hypothèses sous forme de version.' },
      { q: 'Pouvons-nous utiliser nos propres modèles de données ?', a: 'Les exports de facturation des systèmes courants se transposent par correspondance de colonnes dans le modèle standard de Pactlab, et chaque pack sectoriel publie un modèle CSV pour ses extraits, comme un état locatif ou un fichier de prêts.' },
    ],
    related: [{ label: 'Comment ça marche' }, { label: 'Pactlab comparé aux logiciels d’évaluation' }, { label: 'Confiance et sécurité (en anglais)' }],
  },
};
