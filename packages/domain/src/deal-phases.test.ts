import { describe, expect, it } from 'vitest';
import { DEAL_STAGES, phaseOf, postCloseProposals, type PostCloseSourceFinding } from './deal-phases';

describe('pact phases (T-071)', () => {
  it('derives the phase from every pipeline stage', () => {
    expect(Object.fromEntries(DEAL_STAGES.map((stage) => [stage, phaseOf(stage)]))).toEqual({
      SCREENING: 'PRE',
      DILIGENCE: 'DILIGENCE',
      NEGOTIATION: 'DILIGENCE',
      SIGNED: 'DILIGENCE',
      CLOSED: 'POST',
    });
  });

  it('turns diligence output into post-close registers by reference', () => {
    const finding = (overrides: Partial<PostCloseSourceFinding>): PostCloseSourceFinding => ({
      id: 'f',
      title: 'A finding',
      status: 'ACCEPTED',
      direction: null,
      valueDriver: null,
      pricedRiskType: null,
      ...overrides,
    });
    const proposals = postCloseProposals([
      finding({ id: 'cushion', direction: 1, valueDriver: 'Engineering continuity' }),
      finding({ id: 'escrow', direction: -1, pricedRiskType: 'ESCROW' }),
      finding({ id: 'indemnity', direction: -1, pricedRiskType: 'INDEMNITY' }),
      finding({ id: 'fix', direction: -1, pricedRiskType: 'REMEDIATION_COST' }),
      finding({ id: 'open', status: 'DRAFT' }),
      finding({ id: 'rejected', status: 'REJECTED', direction: 1 }),
    ]);
    expect(proposals.map((proposal) => [proposal.kind, proposal.sourceId])).toEqual([
      ['ASSET', 'cushion'],
      ['WATCH', 'escrow'],
      ['WATCH', 'indemnity'],
      ['ACTION', 'fix'],
      ['ACTION', 'open'],
    ]);
    expect(proposals[0]).toMatchObject({ title: 'Engineering continuity', cadence: 'QUARTERLY' });
  });
});
