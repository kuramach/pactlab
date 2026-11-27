import type { Catalog } from '../../lib/i18n/catalog';

/**
 * French comparison page (machine translation, T-171). What it says about the other product is a
 * translation of its public product page as checked in October 2026; the source link stays English.
 */
export const comparisons: Catalog['comparisons'] = {
  'valuation-software': {
    title: 'Pactlab comparé aux logiciels d’évaluation M&A',
    description: 'En quoi Pactlab diffère des logiciels d’évaluation et de modélisation de deals comme MoneySoft DealSense : une due diligence fondée sur les preuves, avec des constats qui se répercutent dans le prix.',
    intro: 'Un logiciel d’évaluation modélise un deal à partir des états financiers que vous saisissez. Pactlab intervient plus tôt : il teste les preuves derrière ces états, consigne ce qu’il trouve et reporte les constats acceptés dans l’évaluation. Les deux répondent à des questions différentes, et beaucoup d’équipes utilisent les deux.',
    them: 'MoneySoft DealSense',
    rows: [
      { topic: 'Point de départ', them: 'États financiers historiques saisis par l’utilisateur ou importés depuis Excel ou un CSV.', pactlab: 'Données sources : exports de facturation, dépôts de code, outils de suivi des tickets, documents et extraits sectoriels.' },
      { topic: 'Constats de due diligence', them: 'Non décrits sur sa page produit.', pactlab: 'Rédige des constats à partir des preuves, chacun avec une citation ; un réviseur désigné accepte, rejette ou demande des justificatifs.' },
      { topic: 'Évaluation', them: 'Évaluation d’entreprise, prix et structuration du deal, projections, ROI et analyse relutive/dilutive.', pactlab: 'Scénarios versionnés (multiple d’ARR, DCF et méthodes sectorielles) avec les constats acceptés reliés au pont de prix.' },
      { topic: 'Code et livraison', them: 'Non décrits sur sa page produit.', pactlab: 'Lit l’historique du dépôt et les outils de suivi des tickets pour les responsabilités, les licences et la santé de la livraison ; ne conserve jamais le code source.' },
      { topic: 'Données de transactions comparables', them: 'Intégrations optionnelles avec des bases comme DealStats, BIZCOMPS et RMA Annual Statement Studies.', pactlab: 'Comparables enregistrés avec leur source, à côté des scénarios fondés sur les preuves.' },
      { topic: 'Rapports', them: 'Évaluations, pitchbooks et mémorandums d’information, propositions d’acquisition et term sheets.', pactlab: 'Constats, registre des affirmations, scénarios d’évaluation et conditions du deal proposées, chacun traçable jusqu’aux preuves.' },
      { topic: 'Où il fonctionne', them: 'Poste de travail Windows, ou bureau à distance Windows, serveur Terminal ou Citrix.', pactlab: 'Dans le navigateur, chaque deal isolé par la sécurité au niveau des lignes dans la base de données.' },
    ],
    conclusion: 'Utilisez un logiciel d’évaluation pour modéliser un deal à partir de comptes convenus. Utilisez Pactlab pour établir quels comptes les preuves justifient, quels risques elles révèlent et comment ces constats modifient le prix, avec une personne qui valide chaque étape.',
    sources: [{ label: 'MoneySoft : page produit DealSense (en anglais)' }],
  },
};
