import { describe, expect, it } from 'vitest';
import { newDemoToken, openDemoToken, sealDemoToken } from './demo-links';

describe('sealed demo links', () => {
  const secret = 'demo-seal-test-'.padEnd(48, 'x');

  it('opens what it sealed, fresh each time', () => {
    const token = newDemoToken();
    const first = sealDemoToken(secret, token);
    expect(first).not.toContain(token);
    expect(first).not.toBe(sealDemoToken(secret, token));
    expect(openDemoToken(secret, first)).toBe(token);
  });

  it('refuses another secret, an altered value, and junk', () => {
    const sealed = sealDemoToken(secret, newDemoToken());
    expect(openDemoToken('another-secret-'.padEnd(48, 'y'), sealed)).toBeNull();
    const [version, iv, body, tag] = sealed.split('.');
    // Change the first character: in base64url the last one carries padding bits a decoder ignores, so
    // rewriting the end could leave the bytes unchanged and the test flaky (#363, 2026-11-27).
    const flipped = `${body!.startsWith('A') ? 'B' : 'A'}${body!.slice(1)}`;
    expect(openDemoToken(secret, [version, iv, flipped, tag].join('.'))).toBeNull();
    expect(openDemoToken(secret, 'v2.a.b.c')).toBeNull();
    expect(openDemoToken(secret, 'nonsense')).toBeNull();
  });
});
