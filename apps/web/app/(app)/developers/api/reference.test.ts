import { describe, expect, it } from 'vitest';
import { describeSchema } from './reference';

describe('API reference (T-128)', () => {
  it('describes a parameter schema in a few words', () => {
    expect(describeSchema({ type: 'string', enum: ['PRE', 'DILIGENCE', 'POST'] })).toBe('PRE | DILIGENCE | POST');
    expect(describeSchema({ type: 'integer', minimum: 1, maximum: 100, default: 50 })).toBe('integer 1–100, default 50');
    expect(describeSchema({ type: 'string', format: 'uuid' })).toBe('string (uuid)');
    expect(describeSchema({ type: 'array', items: { type: 'string' } })).toBe('array of string');
  });
});
