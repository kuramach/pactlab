import { describe, expect, it } from 'vitest';
import { newId } from './ids';
import { objectKeyBelongsTo, tenantObjectKey } from './object-keys';

describe('tenantObjectKey', () => {
  const org = newId();
  const deal = newId();

  it('prefixes keys with organization and deal', () => {
    const key = tenantObjectKey(org, deal, 'documents', 'report.pdf');
    expect(key).toBe(`${org}/${deal}/documents/report.pdf`);
    expect(objectKeyBelongsTo(key, org, deal)).toBe(true);
    expect(objectKeyBelongsTo(key, newId(), deal)).toBe(false);
  });

  it('rejects traversal and non-UUID tenants', () => {
    expect(() => tenantObjectKey(org, deal, '..', 'x')).toThrow();
    expect(() => tenantObjectKey(org, deal, 'a/b')).toThrow();
    expect(() => tenantObjectKey('not-a-uuid', deal, 'x')).toThrow();
    expect(() => tenantObjectKey(org, deal)).toThrow();
  });
});
