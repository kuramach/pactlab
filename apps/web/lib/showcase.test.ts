import { DEAL_SECTION_RULES } from '@pactlab/domain';
import { describe, expect, it } from 'vitest';
import { DEAL_GROUPS } from '../app/(app)/deals/_lib/deal-tabs';
import { SHOWCASE, TOUR_PATHS } from './showcase';

describe('guided tour and callouts (2026-11-13)', () => {
  it('explains every pact tab, and only real tabs', () => {
    const paths = DEAL_GROUPS.flatMap((group) => group.sections.map((section) => section.path));
    expect(Object.keys(SHOWCASE).sort()).toEqual([...paths].sort());
    for (const path of TOUR_PATHS) expect(Object.keys(DEAL_SECTION_RULES), path).toContain(path);
  });

  it('makes no claim the product cannot back', () => {
    const copy = JSON.stringify(SHOWCASE).toLowerCase();
    for (const claim of ['% faster', 'guarantee', 'trusted by', 'revolutionary', 'game-changing', 'certified']) expect(copy).not.toContain(claim);
    for (const entry of Object.values(SHOWCASE)) {
      expect(entry.lookFor.length).toBeGreaterThanOrEqual(2);
      expect(entry.why.length).toBeLessThan(260);
    }
  });
});
