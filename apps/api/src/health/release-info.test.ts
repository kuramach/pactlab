import { describe, expect, it } from 'vitest';
import { HealthController } from './health.controller';
import { ReleaseInfo, type ReleaseSource } from './release-info';

const source = (...values: (string | null)[]): ReleaseSource & { reads: number } => {
  const queue = [...values];
  return {
    reads: 0,
    async read() {
      this.reads += 1;
      return queue.length > 1 ? (queue.shift() ?? null) : (queue[0] ?? null);
    },
  };
};

describe('the release the app reports (T-100)', () => {
  it('reads the deployed release: its tag and commit', async () => {
    const info = new ReleaseInfo(source('{"version":"v2026.11.1","sha":"9f361042abc"}'));
    expect(await info.get()).toEqual({ version: 'v2026.11.1', sha: '9f361042abc' });
    expect(await new HealthController(info).health()).toEqual({ status: 'ok', service: 'api', version: 'v2026.11.1', sha: '9f361042abc' });
  });

  it('reports an untagged commit with no version, and never a malformed one', async () => {
    expect(await new ReleaseInfo(source('{"version":null,"sha":"abc1234"}')).get()).toEqual({ version: null, sha: 'abc1234' });
    expect(await new ReleaseInfo(source('{"version":"<b>1.0</b>","sha":"abc1234"}')).get()).toEqual({ version: null, sha: 'abc1234' });
  });

  it('locally, without a parameter: APP_VERSION or nothing, and the commit "local"', async () => {
    expect(await new ReleaseInfo(null, { version: null, sha: 'local' }).get()).toEqual({ version: null, sha: 'local' });
  });

  it('keeps the last good release when a read fails, and refreshes every five minutes', async () => {
    let now = 0;
    const reads = source('{"version":"v2026.11.1","sha":"aaa"}', null, '{"version":"v2026.11.2","sha":"bbb"}');
    const info = new ReleaseInfo(reads, { version: null, sha: 'local' }, () => now);
    expect((await info.get()).version).toBe('v2026.11.1');
    now += 60_000;
    await info.get();
    expect(reads.reads).toBe(1); // cached within five minutes
    now += 5 * 60_000;
    expect((await info.get()).version).toBe('v2026.11.1'); // the read failed: last good kept
    now += 5 * 60_000;
    expect(await info.get()).toEqual({ version: 'v2026.11.2', sha: 'bbb' });
  });
});
