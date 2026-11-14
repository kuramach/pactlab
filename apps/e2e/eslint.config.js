import base from '@pactlab/config/eslint';

/**
 * Browser-test rules (T-113 part 2, CLAUDE.md "Testing principles"): never wait for time, never
 * check state without retrying, and find elements the way a person does (role, label, text; a test
 * id last), never by a designer's CSS class or an XPath.
 */
const banned = [
  { selector: "CallExpression[callee.property.name='waitForTimeout']", message: 'Never wait for time: use a web-first assertion (expect(locator).toBeVisible(), toHaveText, toHaveURL).' },
  { selector: "Literal[value='networkidle']", message: '`networkidle` is not readiness: wait for what the user would see with a web-first assertion.' },
  {
    selector: "CallExpression[callee.property.name=/^(isVisible|isHidden|isEnabled|isDisabled|isChecked|isEditable)$/]",
    message: 'Non-retrying state checks race the page: assert with expect(locator).toBeVisible() / toBeEnabled() / toBeChecked(), or wait on locator.or(...) first.',
  },
  {
    selector: "CallExpression[callee.property.name='locator'] > Literal:first-child[value=/^(\\.|\\/\\/|xpath=|css=\\.)|\\[class|\\.[a-z][\\w-]*\\s*[\\[>:{,]/]",
    message: 'Locate by role, label or text (getByRole, getByLabel, getByText), or getByTestId as a last resort; never a CSS class or an XPath.',
  },
];

export default [
  ...base,
  {
    files: ['specs/**/*.ts', 'support/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', ...banned] },
  },
];
