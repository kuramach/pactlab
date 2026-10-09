import { describe, expect, it } from 'vitest';
import { dealSection } from './deal-tabs';

const id = '01900000-0000-7000-8000-00000000c003';

describe('dealSection', () => {
  it('finds the section for deal pages and their sub-pages', () => {
    expect(dealSection(id, `/deals/${id}`)).toBe('');
    expect(dealSection(id, `/deals/${id}/sources/upload/x`)).toBe('/sources');
    expect(dealSection(id, `/deals/${id}/evidence/abc`)).toBe('/evidence');
    expect(dealSection(id, `/deals/${id}/finances`)).toBe('/finances');
    expect(dealSection(id, `/deals/${id}/sourcesx`)).toBe('');
  });
});
