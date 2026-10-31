import shared from '@pactlab/config/eslint';

export default [
  ...shared,
  {
    // Lambda handlers (idle pause, ADR 0019) are plain CommonJS for the Node runtime, with no build step.
    files: ['lambda/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { require: 'readonly', exports: 'writable', module: 'writable', process: 'readonly', console: 'readonly' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
];
