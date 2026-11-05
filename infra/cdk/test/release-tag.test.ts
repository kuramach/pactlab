import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** scripts/next-release-tag.sh (T-100): CalVer vYYYY.MM.N, max + 1 within the month. */
const script = resolve(import.meta.dirname, '../../../scripts/next-release-tag.sh');
const next = (month: string, tags: string[]) => spawnSync('bash', [script, month], { input: tags.join('\n'), encoding: 'utf8' });

describe('next release tag', () => {
  it('starts each month at 1', () => {
    expect(next('2026.11', []).stdout.trim()).toBe('v2026.11.1');
    expect(next('2026.12', ['v2026.11.4']).stdout.trim()).toBe('v2026.12.1');
  });

  it('takes the highest of the month plus one, ignoring gaps, other months and stray tags', () => {
    expect(next('2026.11', ['v2026.11.1', 'v2026.11.3', 'v2026.10.9', 'v2026.11.x', 'v2026.110.2', 'release-5']).stdout.trim()).toBe('v2026.11.4');
    expect(next('2026.11', ['v2026.11.10', 'v2026.11.9']).stdout.trim()).toBe('v2026.11.11');
  });

  it('refuses a malformed month', () => {
    for (const month of ['2026.13', '26.11', '2026-11', '']) expect(next(month, []).status, month).toBe(2);
  });
});
