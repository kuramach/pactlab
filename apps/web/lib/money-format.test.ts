import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * One formatter (T-170, ADR 0056): money, numbers and dates in the web app go through `@pactlab/domain`'s
 * formatter (Intl, locale- and currency-aware, the currency's minor unit). No screen calls Intl itself, parses an
 * amount into a float to show it, forces two decimals, or prints a bare `$`.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' || name === '.next' ? [] : files(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const RULES: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /\bIntl\.(NumberFormat|DateTimeFormat)\b/, why: 'Intl called directly' },
  { pattern: /\.toLocale(Date|Time)?String\(/, why: 'toLocaleString called directly' },
  { pattern: /style:\s*'currency'/, why: 'a currency formatter of its own' },
  { pattern: /`\$\$\{/, why: 'a bare $ before an amount' },
  // An amount's decimals padded to two and printed after a point (percent shifts are not this).
  { pattern: /\.\$\{\(fraction \+ '00'\)\.slice\(0, 2\)\}|\.\$\{fraction\.padEnd\(2, '0'\)\.slice\(0, 2\)\}/, why: 'two decimals forced (JPY has none)' },
];

describe('the one formatter', () => {
  it('is the only Intl entry point for money, numbers and dates in the web app', () => {
    const root = join(__dirname, '..');
    const offenders = [...files(join(root, 'app')), ...files(join(root, 'lib'))].flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return RULES.filter((rule) => rule.pattern.test(text)).map((rule) => `${relative(root, file)}: ${rule.why}`);
    });
    expect(offenders, 'Format with formatMoney / formatAmount / formatNumber / formatDate from @pactlab/domain').toEqual([]);
  });
});
