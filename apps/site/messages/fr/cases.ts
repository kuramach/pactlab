import type { Catalog } from '../../lib/i18n/catalog';

/** French case-studies index: the studies themselves are published in English (machine translation, T-171). */
export const cases: Catalog['cases'] = {
  'kroger-albertsons': {
    title: 'Pourquoi la fusion Kroger–Albertsons a-t-elle échoué ?',
    line: 'Kroger / Albertsons (2022–2024) : bloquée le même jour par des tribunaux fédéral et d’État. La leçon : un remède doit répondre au chevauchement, et cela peut se tester avant la signature.',
    outcome: { label: 'Bloquée en justice' },
  },
};
