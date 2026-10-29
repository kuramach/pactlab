import { describe, expect, it } from 'vitest';
import { ConfigError, apiEnvSchema, loadConfig, webServerEnvSchema, workerEnvSchema } from './env';

const validApi = {
  APP_ENV: 'test',
  APP_WEB_ORIGIN: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://pactlab_api:example@localhost:5432/pactlab',
  AUTH0_DOMAIN: 'example.invalid',
  AUTH_TOKEN_SECRET: 'x'.repeat(32),
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

  it('allows a deployment without Auth0, but never a half-configured one', () => {
    const { AUTH0_DOMAIN: _d, AUTH0_AUDIENCE: _a, ...withoutAuth0 } = validApi;
    expect(loadConfig(apiEnvSchema, withoutAuth0).AUTH0_DOMAIN).toBeUndefined();
    const { AUTH0_AUDIENCE: _omitted, ...partial } = validApi;
    expect(() => loadConfig(apiEnvSchema, partial)).toThrow(/AUTH0_AUDIENCE/);
  });

  it('requires sign-up approval unless explicitly turned off', () => {
    expect(loadConfig(apiEnvSchema, validApi).SIGNUP_REQUIRES_APPROVAL).toBe(true);
    expect(loadConfig(apiEnvSchema, { ...validApi, SIGNUP_REQUIRES_APPROVAL: 'false' }).SIGNUP_REQUIRES_APPROVAL).toBe(false);
    expect(() => loadConfig(apiEnvSchema, { ...validApi, SIGNUP_REQUIRES_APPROVAL: 'yes' })).toThrow(/SIGNUP_REQUIRES_APPROVAL/);
  });

  it('keeps AI off by default and needs a Region to switch on Bedrock', () => {
    expect(loadConfig(apiEnvSchema, validApi).AI_PROVIDER).toBe('none');
    expect(loadConfig(apiEnvSchema, { ...validApi, AI_PROVIDER: '', AWS_REGION: '' }).AI_PROVIDER).toBe('none');
    expect(() => loadConfig(apiEnvSchema, { ...validApi, AI_PROVIDER: 'bedrock' })).toThrow(/AWS_REGION/);
    expect(() => loadConfig(apiEnvSchema, { ...validApi, AI_PROVIDER: 'bedrock', AWS_REGION: 'virginia' })).toThrow(/AWS_REGION/);
    expect(loadConfig(apiEnvSchema, { ...validApi, AI_PROVIDER: 'bedrock', AWS_REGION: 'us-east-1' })).toMatchObject({ AI_PROVIDER: 'bedrock', AWS_REGION: 'us-east-1' });
    expect(() => loadConfig(apiEnvSchema, { ...validApi, AI_PROVIDER: 'openai' })).toThrow(/AI_PROVIDER/);
  });

  it('needs the bucket, key and Region for the S3 store, and a sender for SES', () => {
    const s3 = { ...validApi, APP_ENV: 'dev', DOCUMENT_STORE: 's3', DOCUMENT_BUCKET: 'evidence', DOCUMENT_KMS_KEY_ID: 'key', AWS_REGION: 'us-east-1' };
    expect(loadConfig(apiEnvSchema, s3)).toMatchObject({ DOCUMENT_STORE: 's3', DOCUMENT_BUCKET: 'evidence' });
    expect(() => loadConfig(apiEnvSchema, { ...s3, DOCUMENT_BUCKET: '' })).toThrow(/DOCUMENT_BUCKET/);
    expect(() => loadConfig(apiEnvSchema, { ...s3, DOCUMENT_KMS_KEY_ID: undefined })).toThrow(/DOCUMENT_KMS_KEY_ID/);
    expect(() => loadConfig(workerEnvSchema, { APP_ENV: 'dev', DATABASE_URL: validApi.DATABASE_URL, REDIS_URL: 'redis://localhost:6379', DOCUMENT_STORE: 's3', DOCUMENT_BUCKET: 'evidence', DOCUMENT_KMS_KEY_ID: 'key' })).toThrow(/AWS_REGION/);
    expect(() => loadConfig(apiEnvSchema, { ...validApi, EMAIL_PROVIDER: 'ses', AWS_REGION: 'us-east-1' })).toThrow(/EMAIL_FROM/);
    expect(loadConfig(apiEnvSchema, { ...validApi, EMAIL_PROVIDER: 'ses', EMAIL_FROM: 'no-reply@pactlab.ai', AWS_REGION: 'us-east-1' }).EMAIL_PROVIDER).toBe('ses');
  });

  it('allows the signature scanner in development environments only', () => {
    for (const APP_ENV of ['local', 'test', 'dev', 'qa']) expect(loadConfig(apiEnvSchema, { ...validApi, APP_ENV, MALWARE_SCANNER: 'signature' }).MALWARE_SCANNER).toBe('signature');
    for (const APP_ENV of ['stage', 'production']) expect(() => loadConfig(apiEnvSchema, { ...validApi, APP_ENV, MALWARE_SCANNER: 'signature' })).toThrow(/managed scanner/);
  });

  it('requires a strong token secret for email-code sign-in', () => {
    expect(() => loadConfig(apiEnvSchema, { ...validApi, AUTH_TOKEN_SECRET: 'short' })).toThrow(/AUTH_TOKEN_SECRET/);
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

describe('webServerEnvSchema', () => {
  const validWeb = {
    AUTH0_DOMAIN: 'example.invalid',
    AUTH0_CLIENT_ID: 'client-id',
    AUTH0_CLIENT_SECRET: 'client-secret-value',
    AUTH0_SECRET: 'a'.repeat(64),
    APP_BASE_URL: 'http://localhost:3000',
    AUTH0_AUDIENCE: 'https://api.pactlab.test',
  };

  it('parses a valid web server environment', () => {
    expect(loadConfig(webServerEnvSchema, validWeb).APP_BASE_URL).toBe('http://localhost:3000');
  });

  it('fails closed without the client secret, naming only the variable', () => {
    const { AUTH0_CLIENT_SECRET: _omitted, ...missing } = validWeb;
    expect(() => loadConfig(webServerEnvSchema, missing)).toThrow(/AUTH0_CLIENT_SECRET/);
  });

  it('runs email-code only when no Auth0 variable is set', () => {
    expect(loadConfig(webServerEnvSchema, { APP_BASE_URL: 'http://localhost:3000' }).AUTH0_DOMAIN).toBeUndefined();
  });

  it('rejects a short session secret without echoing it', () => {
    const weak = 'too-short-session-secret';
    try {
      loadConfig(webServerEnvSchema, { ...validWeb, AUTH0_SECRET: weak });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toContain('AUTH0_SECRET');
      expect(String(error)).not.toContain(weak);
    }
  });
});
