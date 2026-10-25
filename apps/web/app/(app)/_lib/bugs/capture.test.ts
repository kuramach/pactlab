import { describe, expect, it } from 'vitest';
import { capturable } from './capture';

const node = (tagName: string, attributes: Record<string, string> = {}) => ({
  tagName,
  getAttribute: (name: string) => attributes[name] ?? null,
  hasAttribute: (name: string) => name in attributes,
});

describe('screenshot masking (T-072)', () => {
  it('leaves password fields and data-private elements out of the capture', () => {
    expect(capturable(node('INPUT', { type: 'password' }))).toBe(false);
    expect(capturable(node('input', { type: 'PASSWORD' }))).toBe(false);
    expect(capturable(node('DIV', { 'data-private': '' }))).toBe(false);
    expect(capturable(node('BUTTON', { 'data-bug-report-ui': '' }))).toBe(false);
  });

  it('keeps everything else', () => {
    expect(capturable(node('INPUT', { type: 'text' }))).toBe(true);
    expect(capturable(node('TABLE'))).toBe(true);
    expect(capturable({})).toBe(true);
  });
});
