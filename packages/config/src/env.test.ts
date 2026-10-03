import { describe, expect, it } from 'vitest';
import { ConfigError, apiEnvSchema, loadConfig, workerEnvSchema } from './env';

const validApi = {
  APP_ENV: 'test',
  APP_WEB_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://pactlab_api:example@localhost:5432/pactlab',
  AUTH0_DOMAIN: 'example.invalid',
  AUTH0_AUDIENCE: 'https://api.pactlab.test',
};

describe('loadConfig', () => {
  it('parses a valid API environment and applies defaults', () => {
    const config = loadConfig(apiEnvSchema, validApi);
    expect(config.API_PORT).toBe(4000);
    expect(config.LOG_LEVEL).toBe('info');
  });

  it('fails closed when a required value is missing', () => {
    const { AUTH0_DOMAIN: _omitted, ...missing } = validApi;
    expect(() => loadConfig(apiEnvSchema, missing)).toThrow(ConfigError);
  });

  it('rejects a non-postgres database URL', () => {
    expect(() => loadConfig(apiEnvSchema, { ...validApi, DATABASE_URL: 'mysql://x' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('never echoes secret values in the error message', () => {
    const secret = 'redis-super-secret-value';
    try {
      loadConfig(workerEnvSchema, { APP_ENV: 'test', DATABASE_URL: 'nope', REDIS_URL: secret });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect(String(error)).toContain('REDIS_URL');
    }
  });
});
