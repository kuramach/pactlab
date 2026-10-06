import base from '@pactlab/config/eslint';
import globals from 'globals';

export default [
  // Static export output (`next build`).
  { ignores: ['out/**'] },
  ...base,
  {
    files: ['**/*.tsx'],
    languageOptions: { globals: { ...globals.browser } },
  },
];
