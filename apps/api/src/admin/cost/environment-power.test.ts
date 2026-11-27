import { environmentPowerSchema } from '@pactlab/contracts';
import { describe, expect, it } from 'vitest';
import { powerRolesFrom, readEnvironment, SsmEnvironmentPowerSource, type ParameterReader } from './environment-power';

const reader = (values: Record<string, string>): ParameterReader => ({
  get: async (name) => (name in values ? { value: values[name]!, changedAt: new Date('2026-11-27T10:00:00Z') } : null),
});
const cost = JSON.stringify({ lines: [{ item: 'Secrets Manager', low: '6.80', high: '6.80', basis: '17 secrets × $0.40' }], low: '8.60', high: '14.75', currency: 'USD' });

describe('environment power on the Hosting cost page (ADR 0063)', () => {
  it('shows a hibernated environment with its snapshot and its cost while hibernated', async () => {
    const state = await readEnvironment(
      'stage',
      reader({
        '/pactlab/stage/power': 'hibernated',
        '/pactlab/stage/hibernation': JSON.stringify({ snapshot: 'pactlab-stage-hibernate-20261127t1000z', at: '2026-11-27T10:00:00Z', images: { web: 'abc' } }),
        '/pactlab/stage/hibernated-cost': cost,
      }),
    );
    expect(environmentPowerSchema.parse(state)).toEqual({
      environment: 'stage',
      alwaysOn: false,
      power: 'hibernated',
      since: '2026-11-27T10:00:00.000Z',
      hibernation: { snapshot: 'pactlab-stage-hibernate-20261127t1000z', at: '2026-11-27T10:00:00Z' },
      costWhileHibernated: JSON.parse(cost),
      unreadable: null,
    });
  });

  it('shows a paused environment without a hibernation, and never guesses an unknown state', async () => {
    expect(await readEnvironment('dev', reader({ '/pactlab/dev/power': 'paused', '/pactlab/dev/hibernation': '{"snapshot":"old","at":"2026-11-01T00:00:00Z"}' }))).toMatchObject({ power: 'paused', hibernation: null });
    expect(await readEnvironment('dev', reader({ '/pactlab/dev/power': 'sideways' }))).toMatchObject({ power: null });
    expect(await readEnvironment('qa', reader({ '/pactlab/qa/hibernated-cost': '{"not":"a cost"}', '/pactlab/qa/power': 'awake' }))).toMatchObject({ power: 'awake', costWhileHibernated: null });
  });

  it('says when it cannot read one, rather than showing it awake', async () => {
    expect(await readEnvironment('qa', null)).toMatchObject({ power: null, unreadable: 'NOT_CONFIGURED' });
    expect(await readEnvironment('qa', { get: async () => Promise.reject(new Error('AccessDenied')) })).toMatchObject({ power: null, unreadable: 'UNAVAILABLE' });
  });

  it('lists dev, qa, stage and live (always on), and reads at most once a minute', async () => {
    let reads = 0;
    let now = 0;
    const source = new SsmEnvironmentPowerSource({
      region: 'us-east-2',
      self: 'prod',
      roles: {},
      now: () => now,
      readerFor: async () => {
        reads += 1;
        return reader({});
      },
    });
    const first = await source.read();
    expect(first.map((e) => [e.environment, e.alwaysOn])).toEqual([['dev', false], ['qa', false], ['stage', false], ['prod', true]]);
    await source.read();
    expect(reads).toBe(3);
    now = 61_000;
    await source.read();
    expect(reads).toBe(6);
  });

  it('accepts only the read-only power roles', () => {
    expect(powerRolesFrom('dev=arn:aws:iam::111111111111:role/pactlab-dev-power-read,stage=arn:aws:iam::222222222222:role/Admin,live=x')).toEqual({ dev: 'arn:aws:iam::111111111111:role/pactlab-dev-power-read' });
  });
});
