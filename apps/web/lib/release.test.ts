import { describe, expect, it } from 'vitest';
import { releaseLabel } from './release';

describe('the version line (T-100)', () => {
  it('shows the release and a short build, or just the build when untagged', () => {
    expect(releaseLabel({ version: 'v2026.11.1', sha: '9f361042abcdef' })).toBe('v2026.11.1 · build 9f36104');
    expect(releaseLabel({ version: null, sha: '9f361042abcdef' })).toBe('build 9f36104');
    expect(releaseLabel({ version: null, sha: 'local' })).toBe('local build');
    expect(releaseLabel(null)).toBe('version unknown');
  });
});
