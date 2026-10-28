import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buyerViability,
  certaintyStatus,
  cherryPick,
  headroom,
  incoherentPackage,
  laborExposure,
  overlapPockets,
  unaddressedFeedback,
  unverifiablePledges,
} from './checks';
import type { Commitment, DealCertaintyTerms, FeedbackRound, PackageRevision, RegFinding, RemedyBuyer, RemedyPackage, Site } from './types';

/**
 * Case 1 regression (T-092): the synthetic Kroger-Albertsons analog. Every
 * item of the findings key — fixed before the first run — must surface in its
 * expected phase, direction and at least its severity. A miss is a product
 * finding against the responsible check, never a reason to re-key the case.
 */
const CASE = resolve(import.meta.dirname, '../../../../demo-data/cases/case-01-grocery');
const read = (file: string) => readFileSync(join(CASE, file), 'utf8');
const json = <T>(file: string) => JSON.parse(read(file)) as T;
const AS_OF = '2024-08-26';
const SEVERITY = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

function sites(): Site[] {
  // The case CSV has no quoted fields (the generator writes none).
  const [head = '', ...lines] = read('sites.csv').trim().split('\n');
  const header = head.split(',');
  return lines.map((line) => {
    const cells = line.split(',');
    const cell = (column: string) => cells[header.indexOf(column)] ?? '';
    return {
      siteId: cell('site_id'),
      party: cell('party') as Site['party'],
      firm: cell('firm'),
      market: cell('market'),
      region: cell('region'),
      banner: cell('banner'),
      fullService: cell('full_service') === 'yes',
      sales: cell('sales'),
      performance: cell('performance'),
      unionized: cell('unionized') === 'yes',
      cbaId: cell('cba_id') || null,
      distributionCenter: cell('distribution_center'),
      systems: cell('systems'),
    };
  });
}

interface KeyItem {
  readonly id: number;
  readonly defect: string;
  readonly check: string;
  readonly phase: 'PRE' | 'DILIGENCE';
  readonly direction: -1;
  readonly minSeverity: (typeof SEVERITY)[number];
}

const all = sites();
const remedy = json<RemedyPackage>('package.json');
const terms = json<DealCertaintyTerms>('terms.json');
const feedback = json<{ rounds: FeedbackRound[]; revisions: PackageRevision[] }>('feedback.json');

/** The whole pipeline, as the module runs it: Pre screen, then the workbench and registers. */
const findings: RegFinding[] = [
  ...overlapPockets(all),
  ...laborExposure(all),
  ...headroom(terms, remedy),
  ...cherryPick(all, remedy),
  ...incoherentPackage(all, remedy),
  ...buyerViability(json<RemedyBuyer>('buyer.json'), remedy),
  ...unaddressedFeedback(feedback.rounds, feedback.revisions, AS_OF),
  ...unverifiablePledges(json<Commitment[]>('commitments.json')),
];
const report: string[] = [];

describe('Case 1 — synthetic Kroger-Albertsons analog: every key item surfaces', () => {
  const key = json<{ items: KeyItem[] }>('key.json');
  for (const item of key.items) {
    it(`key ${item.id} (${item.phase}): ${item.defect}`, () => {
      const hit = findings.find((finding) => finding.check === item.check);
      report.push(`${hit && hit.phase === item.phase ? 'PASS' : 'MISS'}  ${item.id}  ${item.phase.padEnd(9)}  ${item.check}${hit ? ` — ${hit.title}` : ''}`);
      expect(hit, `missed: ${item.defect}`).toBeDefined();
      expect(hit?.phase).toBe(item.phase);
      expect(hit?.direction).toBe(item.direction);
      expect(SEVERITY.indexOf(hit?.severity ?? 'LOW')).toBeGreaterThanOrEqual(SEVERITY.indexOf(item.minSeverity));
    });
  }

  it('the headroom, long-stop and fee exposure match the agreement', () => {
    expect(headroom(terms, remedy)[0]?.inputs).toMatchObject({ cap: 650, offered: 579, unused: 71 });
    expect(certaintyStatus(terms, AS_OF)).toEqual({ elapsedDays: 682, daysToOutsideDate: 141, feeExposure: { ACQUIRER: '600000000', TARGET: '0' } });
  });

  it('only round 2 is unanswered — the case plants one aging criticism, not every round', () => {
    expect(unaddressedFeedback(feedback.rounds, feedback.revisions, AS_OF).map((finding) => finding.inputs['topic'])).toEqual(['COHERENCE']);
  });

  afterAll(() => {
    process.stdout.write(['', 'Case 1 regression — per key item, by phase:', ...report.sort(), '', ''].join('\n'));
  });
});
