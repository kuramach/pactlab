import { describe, expect, it } from 'vitest';
import { seedEmail } from './synthetic';

describe('seed email addresses', () => {
  it('keeps the .example address locally, and plus-addresses a real inbox when deployed', () => {
    expect(seedEmail('lead@charlie.example', 'charlie-lead')).toBe('lead@charlie.example');
    expect(seedEmail('lead@charlie.example', 'charlie-lead', 'kumar@example.com')).toBe('kumar+charlie-lead@example.com');
    expect(() => seedEmail('lead@charlie.example', 'charlie-lead', 'not-an-address')).toThrow(/DEMO_INBOX/);
  });
});
