import type { Catalog } from '../../lib/i18n/catalog';

/** French guides (machine translation, T-171). */
export const guides: Catalog['guides'] = {
  'saas-acquisition-due-diligence': {
    title: 'Comment mener la due diligence d’une acquisition SaaS ?',
    description: 'Une check-list pratique pour la due diligence d’une acquisition SaaS : revenus, rétention, contrats, code et évaluation, et comment garder chaque constat lié à ses preuves.',
    intro: 'La due diligence SaaS se résume à une question : les preuves justifient-elles le chiffre que vous vous apprêtez à payer ? Travaillez à partir des données sources, pas des synthèses, et laissez chaque constat porter sa citation jusque dans le prix.',
    sections: [
      {
        heading: '1. Reconstruire les revenus récurrents à partir de la facturation',
        body: 'L’ARR de la direction est une affirmation. Reconstruisez le MRR et l’ARR à partir des lignes de facture de l’export de facturation, puis rapprochez les deux et expliquez l’écart.',
        points: [
          'Annualiser le dernier mois à partir de la facturation, pas d’un rapport de pipeline ou de prises de commandes.',
          'Distinguer chaque mois les nouveaux revenus, l’expansion, la contraction et le churn.',
          'Rechercher une contraction cachée derrière un nombre de clients stable.',
          'Mesurer la concentration des clients : la part des revenus provenant des plus gros clients.',
        ],
      },
      {
        heading: '2. Tester la rétention par cohorte',
        points: ['La rétention nette et brute des revenus par cohorte d’inscription, pas un seul chiffre global.', 'Si les cohortes récentes se comportent comme les plus anciennes.', 'Quels clients portent l’expansion nette.'],
      },
      {
        heading: '3. Lire les contrats qui font bouger le prix',
        points: [
          'Les clauses de changement de contrôle et de résiliation pour convenance dans les contrats des plus gros clients.',
          'Les clauses de révision de prix et du client le plus favorisé.',
          'La dette et les éléments assimilés à de la dette au bilan.',
        ],
      },
      {
        heading: '4. Contrôler le code et l’équipe qui le porte',
        body: 'Lisez l’historique du dépôt pour les responsabilités et le risque lié aux personnes clés, l’exposition aux licences, et pour savoir si la livraison correspond à la feuille de route. Le guide de la due diligence technique donne le détail.',
      },
      {
        heading: '5. Tenir un registre des affirmations',
        body: 'Listez ce que dit le vendeur (ARR, churn, effectifs, piste de trésorerie) à côté de ce que montrent les preuves, et marquez chaque point comme confirmé, contredit ou non vérifié. Une affirmation contredite est généralement un constat.',
      },
      {
        heading: '6. Chiffrer ce que vous trouvez',
        body: 'Évaluez avec un multiple d’ARR et un DCF sur des chiffres rapprochés. Reliez chaque constat accepté et chiffré au pont de prix comme ajustement, afin que l’écart entre le prix demandé et la valeur justifiée soit expliqué ligne par ligne.',
      },
      {
        heading: 'Comment Pactlab procède',
        body: 'Pactlab importe l’export de facturation, reconstruit le grand livre des revenus, lit le dépôt et les documents, et rédige des constats avec leurs citations. Un réviseur désigné accepte ou rejette chacun ; les constats acceptés alimentent des scénarios d’évaluation versionnés et le pont de prix.',
      },
    ],
    related: [{ label: 'Due diligence logiciel et SaaS' }, { label: 'Revenus et indicateurs SaaS (en anglais)' }, { label: 'Sextant : évaluation et conditions du deal (en anglais)' }],
  },
  'technical-due-diligence-with-ai': {
    title: 'Comment mener la due diligence technique d’une acquisition de logiciel avec l’IA ?',
    description: 'Ce que couvre la due diligence technique (responsabilité du code, licences, santé de la livraison et risque lié aux personnes clés) et comment l’IA peut lire les preuves pendant que des personnes décident.',
    intro: 'La due diligence technique se demande si le produit pourra continuer d’être développé après le closing, par qui et avec quel risque. L’IA aide à lire rapidement de longs historiques ; les jugements restent aux personnes.',
    sections: [
      {
        heading: 'Ce qu’il faut lire',
        points: [
          'L’historique des commits : qui travaille sur quelles parties du code, et comment cela a évolué.',
          'Les responsabilités : les zones à un seul mainteneur, et les contributeurs qui sont partis.',
          'Les dépendances et les licences : des licences copyleft ou inconnues dans le code livré.',
          'La livraison : engagements de sprint face au réalisé, temps de cycle et travaux rouverts.',
          'Les pull requests et les revues : si les modifications sont revues avant d’être livrées.',
        ],
      },
      {
        heading: 'Là où l’IA aide',
        body: 'Lire des milliers de commits, de tickets et de pull requests, les regrouper par zone de code et rédiger des constats comme « une seule personne est responsable du service de facturation ». Chaque constat rédigé doit citer les commits ou les tickets qui le sous-tendent.',
      },
      {
        heading: 'Là où les personnes décident',
        body: 'Si une dépendance à une personne clé compte, ce que doit être un plan de rétention et comment un risque se chiffre. Les données personnelles demandent du soin : utilisez des agrégats par défaut, protégez les vues nominatives et n’envoyez jamais de données de rémunération ou de performance à un modèle.',
      },
      {
        heading: 'Garder le code source hors du dossier',
        body: 'Analysez dans un espace de travail isolé et éphémère et ne conservez que les constats, les chemins, les empreintes et les versions des outils. La due diligence n’a pas besoin d’une copie du code de la cible.',
      },
      {
        heading: 'Comment Pactlab procède',
        body: 'Pactlab se connecte à GitHub et à Jira, lit les métadonnées et l’historique, et présente les responsabilités, la santé de la livraison et le risque lié aux personnes clés à l’échelle des équipes. Les constats portent leurs citations jusqu’à la revue et, une fois acceptés et chiffrés, jusqu’à l’évaluation.',
      },
    ],
    related: [{ label: 'Technologie et code (en anglais)' }, { label: 'Santé de la livraison (en anglais)' }, { label: 'Due diligence logiciel et SaaS' }],
  },
  'prepare-for-vc-due-diligence': {
    title: 'Comment un fondateur doit-il se préparer à la due diligence d’un fonds de capital-risque ?',
    description: 'La check-list du fondateur pour la due diligence des investisseurs : confronter l’ARR, la piste de trésorerie, la table de capitalisation, les SAFE et la propriété intellectuelle à vos propres données avant qu’un investisseur ne le fasse.',
    intro: 'Les investisseurs confrontent ce que dit votre présentation à vos données. Faites le même test en premier, corrigez ce que vous pouvez et expliquez ce que vous ne pouvez pas corriger, avant que cela ne devienne un point de négociation.',
    sections: [
      {
        heading: 'Confronter vos chiffres à vos données',
        points: [
          'L’ARR de la présentation face à l’ARR de votre système de facturation pour le dernier mois.',
          'La piste de trésorerie de la présentation face à la trésorerie divisée par le burn net des trois derniers mois.',
          'La concentration des clients : la part des revenus que représentent vos plus gros clients.',
        ],
      },
      {
        heading: 'Contrôler votre table de capitalisation',
        points: [
          'Les actions émises correspondent aux statuts et aux décisions du conseil.',
          'Chaque SAFE et chaque obligation : plafond, décote et clause de la nation la plus favorisée, une telle clause pouvant convertir un SAFE ancien au plafond plus bas d’un SAFE ultérieur.',
          'Le pool d’options que demandera l’investisseur, et s’il est pris sur la valorisation pré-money.',
        ],
      },
      {
        heading: 'Contrôler la propriété de ce que vous avez construit',
        points: ['La cession de propriété intellectuelle dans chaque contrat de fondateur, de salarié et de prestataire.', 'Le vesting des fondateurs et les options fiscales consignés.'],
      },
      {
        heading: 'Comparer les offres sur ce que vous conservez',
        body: 'Pour chaque term sheet, modélisez le tour : prix par action, conversion des SAFE, pool et participation des fondateurs après le closing. La valorisation pré-money affichée n’est pas toute la réponse.',
      },
      {
        heading: 'Comment Pactlab procède',
        body: 'Venture Raise importe votre export de facturation, votre table de capitalisation et vos comptes mensuels, lit vos documents et signale chaque écart avec sa source. L’onglet Raise modélise chaque offre côte à côte, et la vue investisseur ne partage que les chiffres vérifiés que vous choisissez.',
      },
    ],
    related: [{ label: 'Venture Raise' }, { label: 'Questions et réponses des fondateurs' }],
  },
};
