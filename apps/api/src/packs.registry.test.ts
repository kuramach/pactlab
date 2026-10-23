import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ENGINE_VALUATION_METHODS, METRIC_CALCULATORS } from '@pactlab/calculations';
import { PACK_IDS, PACKS } from '@pactlab/domain';
import { describe, expect, it } from 'vitest';

/** The pack registry (domain) agrees with the calculators, the engine and the marketing site. */
describe('pack registry across packages', () => {
  it('every pack names a calculator and valuation methods that exist', () => {
    for (const id of PACK_IDS) {
      expect(METRIC_CALCULATORS[PACKS[id].metricCalculator], id).toBeDefined();
      for (const method of PACKS[id].valuationMethods) expect(ENGINE_VALUATION_METHODS, `${id}: ${method}`).toContain(method);
    }
  });

  it('pack slugs are exactly the industries on the website', () => {
    const content = readFileSync(join(resolve(import.meta.dirname, '../../..'), 'apps/site/lib/content.ts'), 'utf8');
    const industries = content.slice(content.indexOf('export const INDUSTRIES'));
    const slugs = [...industries.matchAll(/^ {4}slug: '([a-z0-9-]+)',$/gm)].map((match) => match[1]);
    expect(PACK_IDS.map((id) => PACKS[id].slug).sort()).toEqual([...slugs].sort());
  });
});
