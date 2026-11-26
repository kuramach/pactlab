import { describe, expect, it } from 'vitest';
import { VALUATION_DIRECTIONS } from '../findings/types';
import { FINANCIAL_PNL } from '../imports/targets';
import {
  addBackCounts,
  QOE_ADD_BACK_EVIDENCE_TYPE,
  QOE_ADJUSTMENT_CATEGORIES,
  QOE_CATEGORY_REGISTRY,
  QOE_COMPONENT_REGISTRY,
  QOE_DIRECTION_MAP,
  QOE_PNL_CONFLICT_EVIDENCE_TYPE,
  PNL_LINE_EVIDENCE_TYPE,
  QOE_VERIFICATION_STATUSES,
  QOE_WORKING_CAPITAL_COMPONENTS,
  qoeDirectionFor,
} from './registry';

describe('QoE registry (T-135)', () => {
  it('maps every adjustment category and working-capital component', () => {
    expect(Object.keys(QOE_CATEGORY_REGISTRY).sort()).toEqual([...QOE_ADJUSTMENT_CATEGORIES].sort());
    expect(Object.keys(QOE_COMPONENT_REGISTRY).sort()).toEqual([...QOE_WORKING_CAPITAL_COMPONENTS].sort());
    for (const category of QOE_ADJUSTMENT_CATEGORIES) expect(QOE_CATEGORY_REGISTRY[category].label.length).toBeGreaterThan(3);
  });

  it('gives every add-back status a direction rule, and follows the direction-map rules', () => {
    for (const status of QOE_VERIFICATION_STATUSES) expect(() => qoeDirectionFor(QOE_ADD_BACK_EVIDENCE_TYPE, status)).not.toThrow();
    for (const [type, rules] of Object.entries(QOE_DIRECTION_MAP)) {
      for (const rule of rules) {
        expect((VALUATION_DIRECTIONS as readonly number[]).includes(rule.defaultDirection), `${type}/${rule.signal}`).toBe(true);
        if (rule.defaultDirection === 0) expect(rule.rationale?.trim().length ?? 0).toBeGreaterThan(10);
        // No price-increase channel: upside is confirmed value only.
        if (rule.defaultDirection === 1) expect(rule.channel).toBe('CONFIRMATION');
        if (rule.defaultDirection === -1) expect(['PRICED_TERM', 'ASSUMPTION']).toContain(rule.channel);
      }
    }
    expect(() => qoeDirectionFor(QOE_ADD_BACK_EVIDENCE_TYPE, 'SELLER_SAYS_SO')).toThrow(/no direction rule/);
  });

  it('makes an imported P&L disagreeing with a filed statement an unpriced drag to review (T-149)', () => {
    expect(qoeDirectionFor(QOE_PNL_CONFLICT_EVIDENCE_TYPE, 'disagrees')).toMatchObject({ defaultDirection: -1, channel: 'ASSUMPTION' });
    expect(PNL_LINE_EVIDENCE_TYPE).toBe(FINANCIAL_PNL.evidenceType);
  });

  it('keeps unverified add-backs out unless a reviewer includes them', () => {
    expect(addBackCounts('UNVERIFIED', null)).toEqual({ counts: false, basis: null });
    expect(addBackCounts('UNVERIFIED', 'INCLUDE')).toEqual({ counts: true, basis: 'CLAIMED' });
    expect(addBackCounts('PARTIALLY_VERIFIED', null)).toEqual({ counts: true, basis: 'VERIFIED' });
    expect(addBackCounts('VERIFIED', null)).toEqual({ counts: true, basis: 'CLAIMED' });
    expect(addBackCounts('VERIFIED', 'EXCLUDE')).toEqual({ counts: false, basis: null });
  });
});
