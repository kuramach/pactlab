import { DEAL_SECTION_RULES, sectionApplies } from '@pactlab/domain';
import { describe, expect, it } from 'vitest';
import { TRY_PACKS, trySteps } from './try';

/** The "Try it" walk-throughs follow the app (T-124): a step on a removed, renamed or inapplicable section fails here. */
describe('Try it steps', () => {
  it('every in-app step names a section the pact really shows', () => {
    const problems: string[] = [];
    for (const pack of TRY_PACKS) {
      for (const step of trySteps(pack)) {
        if (/ → /.test(step.where) && !step.section) problems.push(`${pack.slug}: "${step.where}" has no section`);
        if (!step.section) continue;
        if (!(step.section in DEAL_SECTION_RULES)) problems.push(`${pack.slug}: ${step.section} is not a pact section`);
        else if (!sectionApplies(step.section, { companyType: pack.type, initiatedBy: 'BUYER' })) problems.push(`${pack.slug}: ${step.section} does not apply to this pack`);
      }
    }
    expect(TRY_PACKS.length).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});
