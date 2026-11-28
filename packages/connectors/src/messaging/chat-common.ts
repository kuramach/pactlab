import { ChannelSendError, type ChatMessage } from './types';

/**
 * Shared by the Slack and Teams adapters (T-181): one bounded wait on a rate limit, then give up.
 * Slack answers `429` with `Retry-After` in seconds (docs.slack.dev, "Rate limits"); Teams and the Bot
 * Connector answer `429` with `Retry-After` too (learn.microsoft.com, "Optimize your bot: rate limiting").
 * A wait longer than `maxWaitMs` is not taken: the send fails as rate-limited and is not retried here.
 */
export interface RateLimitOptions {
  readonly maxWaitMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Seconds in a `Retry-After` header (delta-seconds only), or null. */
export function retryAfterMs(response: Response): number | null {
  const value = response.headers.get('retry-after');
  if (!value || !/^\d{1,6}$/.test(value.trim())) return null;
  return Number(value.trim()) * 1000;
}

/** Run a request; on 429, wait once as told (within the bound) and run it again. */
export async function withRateLimit(provider: string, request: () => Promise<Response>, options: RateLimitOptions = {}): Promise<Response> {
  const maxWait = options.maxWaitMs ?? 30_000;
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await request();
    } catch {
      throw new ChannelSendError(`${provider}Unreachable`);
    }
    if (response.status !== 429) return response;
    const wait = retryAfterMs(response) ?? 1000;
    if (attempt > 0 || wait > maxWait) throw new ChannelSendError(`${provider}429`);
    await sleep(wait);
  }
}

/** The plain text of a message, for platforms' notification previews: the words and the link, nothing else. */
export function plainText(message: ChatMessage): string {
  return message.action?.kind === 'LINK' ? `${message.text} ${message.action.url}` : message.text;
}
