import { describe, expect, it } from 'vitest';
import { brandThemeVariables, contrast, fillUnderNavy, nearestBrandFont, readableOnWhite, textOn } from './brand';

describe('brand kits (T-123)', () => {
  it('keeps a readable accent and darkens one that fails AA on white, keeping its hue', () => {
    expect(readableOnWhite('#4a58e8')).toEqual({ color: '#4a58e8', adjusted: false });
    const pale = readableOnWhite('#7fd3ff');
    expect(pale.adjusted).toBe(true);
    expect(contrast(pale.color, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(readableOnWhite('nope')).toEqual({ color: '#6978ff', adjusted: true });
  });

  it('puts navy text on light fills and white on dark ones', () => {
    expect(textOn('#6978ff')).toBe('#081127');
    expect(textOn('#081127')).toBe('#ffffff');
  });

  it('maps a site font to the nearest one Pactlab carries', () => {
    expect(nearestBrandFont('"Inter", sans-serif')).toBe('INTER');
    expect(nearestBrandFont('Georgia, serif')).toBe('SOURCE_SERIF');
    expect(nearestBrandFont('"Brand Display", sans-serif')).toBe('MANROPE');
    expect(nearestBrandFont(null)).toBe('MANROPE');
  });
});

describe('brand theme variables (T-123)', () => {
  it('overrides nothing for the Pactlab kit', () => {
    expect(brandThemeVariables({ accentColor: null, font: 'MANROPE' })).toBeNull();
  });

  it('keeps navy readable on the fill and the ink readable on white, whatever the accent', () => {
    for (const accent of ['#0b1f4d', '#ffd400', '#1a7f37', '#e11d48']) {
      const variables = brandThemeVariables({ accentColor: accent, font: 'INTER' }) as Record<string, string>;
      expect(contrast(variables['--color-indigo'] as string, '#081127')).toBeGreaterThanOrEqual(4.5);
      expect(contrast(variables['--color-indigo-ink'] as string, '#ffffff')).toBeGreaterThanOrEqual(4.5);
      expect(variables['--font-sans']).toContain('--font-inter');
    }
    expect(fillUnderNavy('#ffd400')).toBe('#ffd400');
  });
});
