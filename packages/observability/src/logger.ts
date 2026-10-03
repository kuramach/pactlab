import { pino, type Logger, type LoggerOptions } from 'pino';

/** Correlation fields every log line may carry (spec §14). */
export interface LogContext {
  requestId?: string;
  correlationId?: string;
  organizationId?: string;
  dealId?: string;
  userId?: string;
  jobId?: string;
  aiRunId?: string;
}

/**
 * Never log secrets, tokens, document content, source code, compensation or
 * raw provider payloads. These paths are censored wherever they appear.
 */
export const REDACT_PATHS = [
  'authorization',
  'password',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'cookie',
  'content',
  'sourceCode',
  'compensation',
  'salary',
  'baseSalary',
  'providerPayload',
  'rawPayload',
  'req.headers.authorization',
  'req.headers.cookie',
  '*.authorization',
  '*.password',
  '*.secret',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.apiKey',
  '*.cookie',
  '*.content',
  '*.sourceCode',
  '*.compensation',
  '*.salary',
  '*.baseSalary',
  '*.providerPayload',
  '*.rawPayload',
];

export function createLogger(
  service: string,
  options: { level?: string; destination?: pino.DestinationStream } = {},
): Logger {
  const config: LoggerOptions = {
    level: options.level ?? 'info',
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    messageKey: 'message',
  };
  return options.destination ? pino(config, options.destination) : pino(config);
}

export function withContext(logger: Logger, context: LogContext): Logger {
  return logger.child(context);
}

export type { Logger };
