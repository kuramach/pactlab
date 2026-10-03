import base from '@pactlab/config/eslint';
import globals from 'globals';

export default [
  ...base,
  {
    files: ['**/*.tsx'],
    languageOptions: { globals: { ...globals.browser } },
  },
];
