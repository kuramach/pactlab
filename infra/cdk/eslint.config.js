import shared from '@pactlab/config/eslint';

export default [
  ...shared,
  {
    // Lambda handlers (idle pause, ADR 0019) are plain CommonJS for the Node runtime, with no build step.
    files: ['lambda/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { require: 'readonly', exports: 'writable', module: 'writable', process: 'readonly', console: 'readonly' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // CloudFront Functions (T-171): plain scripts whose `handler` the runtime calls, with `LOCALES` prepended at synth.
    files: ['functions/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { LOCALES: 'readonly' } },
    rules: { 'no-unused-vars': ['error', { varsIgnorePattern: '^handler$' }], '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^handler$' }] },
  },
];
