import { describe, expect, it } from 'vitest';
import { isBusy, isSchedulerJob } from './queue-state';

describe('the hibernate queue check (ADR 0063)', () => {
  const empty = { queue: 'pactlab-default', waiting: 0, active: 0, delayed: 0, scheduled: 0 };

  it('lets an empty queue hibernate, even with scheduler jobs pending (the worker re-registers them on start)', () => {
    expect(isBusy({ ...empty, scheduled: 1 })).toBe(false);
  });

  it('stops for anything waiting, running or delayed by someone', () => {
    expect(isBusy({ ...empty, waiting: 1 })).toBe(true);
    expect(isBusy({ ...empty, active: 1 })).toBe(true);
    expect(isBusy({ ...empty, delayed: 2 })).toBe(true);
  });

  it("tells a job scheduler's next job from a person's delayed job", () => {
    expect(isSchedulerJob('repeat:signing-poll-sweep:1764200000000')).toBe(true);
    expect(isSchedulerJob('org-1:deal-1:import-abc')).toBe(false);
    expect(isSchedulerJob(undefined)).toBe(false);
  });
});
