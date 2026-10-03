import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, withContext } from './logger';

function capture() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  return { lines, destination };
}

describe('createLogger', () => {
  it('redacts secrets, tokens and compensation', () => {
    const { lines, destination } = capture();
    const logger = createLogger('test', { destination });
    logger.info(
      { token: 't0ps3cret', user: { salary: '123456', password: 'pw' }, req: { headers: { authorization: 'Bearer abc' } } },
      'hello',
    );
    const output = lines.join('');
    for (const leaked of ['t0ps3cret', '123456', 'pw"', 'Bearer abc']) {
      expect(output).not.toContain(leaked);
    }
    expect(output).toContain('[REDACTED]');
  });

  it('carries tenant correlation fields', () => {
    const { lines, destination } = capture();
    withContext(createLogger('test', { destination }), { organizationId: 'org-1', jobId: 'job-1' }).info('x');
    const record = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(record).toMatchObject({ service: 'test', organizationId: 'org-1', jobId: 'job-1', message: 'x' });
  });
});
