import { describe, expect, it } from 'vitest';
import { deviceLabel, trustChoice } from './device-label';

describe('device labels (T-112)', () => {
  it('names common browsers and systems, and nothing more', () => {
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')).toBe('Chrome on macOS');
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1')).toBe('Safari on iOS');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0')).toBe('Edge on Windows');
    expect(deviceLabel('Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0')).toBe('Firefox on Linux');
    expect(deviceLabel('curl/8.4.0')).toBeUndefined();
    expect(deviceLabel(null)).toBeUndefined();
  });

  it('falls back to 8 hours for anything but a known choice', () => {
    expect(trustChoice('1w')).toBe('1w');
    expect(trustChoice('1y')).toBe('8h');
    expect(trustChoice(null)).toBe('8h');
  });
});
