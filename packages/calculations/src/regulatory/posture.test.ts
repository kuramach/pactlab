import { describe, expect, it } from 'vitest';
import { orderPosture, summarizePosture, type PostureSignal } from './posture';

const signal = (id: string, date: string, direction: PostureSignal['direction']): PostureSignal => ({ id, date, authority: 'Agency', scope: 'SECTOR_SIGNAL', direction, signal: 'A signal' });

describe('posture signals', () => {
  it('counts the evidence and names the direction most signals point', () => {
    expect(summarizePosture([])).toEqual({ signals: 0, tightening: 0, holding: 0, loosening: 0, latest: null, lean: null });
    expect(summarizePosture([signal('a', '2023-12-18', 'TIGHTENING'), signal('b', '2024-01-15', 'TIGHTENING'), signal('c', '2024-03-01', 'LOOSENING')])).toEqual({
      signals: 3,
      tightening: 2,
      holding: 0,
      loosening: 1,
      latest: '2024-03-01',
      lean: 'TIGHTENING',
    });
  });

  it('says MIXED when no direction leads, and orders newest first', () => {
    const signals = [signal('a', '2023-12-18', 'TIGHTENING'), signal('b', '2024-03-01', 'LOOSENING')];
    expect(summarizePosture(signals).lean).toBe('MIXED');
    expect(orderPosture(signals).map((item) => item.id)).toEqual(['b', 'a']);
  });
});
