import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { controlsByArea, openGaps, PILOT_CONTROLS, statusLabel, statusVariant } from './controls';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');

describe('pilot control register', () => {
  it('has unique ids', () => {
    const ids = PILOT_CONTROLS.map((control) => control.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('points every control at a runbook that exists', () => {
    for (const control of PILOT_CONTROLS) {
      expect(control.runbook).toMatch(/^docs\/runbooks\/[a-z0-9-]+\.md$/);
      expect(existsSync(resolve(repoRoot, control.runbook)), control.runbook).toBe(true);
    }
  });

  it('groups every control under exactly one area', () => {
    const grouped = controlsByArea().flatMap((group) => group.controls);
    expect(grouped).toHaveLength(PILOT_CONTROLS.length);
  });

  it('reports open gaps rather than hiding them', () => {
    expect(openGaps().map((control) => control.id)).toEqual(['sso', 'audit-export', 'ai-metering']);
    expect(statusLabel('GAP')).toBe('gap');
    expect(statusVariant('GAP')).toBe('danger');
    expect(statusVariant('IN_PLACE')).toBe('calculation');
  });
});
