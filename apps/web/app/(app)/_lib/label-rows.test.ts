import { describe, expect, it } from 'vitest';
import { labelRows } from './label-rows';

describe('chart label rows (batch 2)', () => {
  it('keeps far-apart labels on one row and stacks close ones', () => {
    expect(labelRows([2, 6], 1)).toEqual([0, 0]);
    // Sextant 4.0×, Ask 5.0× and a third at 4.3×: the close pair splits.
    expect(labelRows([4.0, 5.0, 4.3], 0.9)).toEqual([0, 0, 1]);
    expect(labelRows([4, 4, 4], 0.5)).toEqual([0, 1, 2]);
    expect(labelRows([], 1)).toEqual([]);
  });
});
