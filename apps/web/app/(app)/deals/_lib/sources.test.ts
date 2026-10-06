import { describe, expect, it } from 'vitest';
import { failureHint, sourceHealth } from './sources';

const run = (status: string, issuesCount = 0) => ({
  id: 'r',
  status,
  connectorVersion: 'v',
  recordsSeen: 1,
  recordsCreated: 1,
  issuesCount,
  errorClass: null,
  completedAt: null,
});

describe('sourceHealth', () => {
  it('distinguishes clean, gappy, failed and never-synced sources', () => {
    expect(sourceHealth({ lastSyncRun: run('SUCCEEDED') })).toBe('synced');
    expect(sourceHealth({ lastSyncRun: run('SUCCEEDED', 3) })).toBe('issues');
    expect(sourceHealth({ lastSyncRun: run('FAILED') })).toBe('failed');
    expect(sourceHealth({ lastSyncRun: run('RUNNING') })).toBe('never');
    expect(sourceHealth({ lastSyncRun: null })).toBe('never');
  });

  it('explains permission failures without provider detail', () => {
    expect(failureHint('GitHubAdapterError')).toMatch(/permission/);
    expect(failureHint(null)).toMatch(/Retry/);
  });
});
