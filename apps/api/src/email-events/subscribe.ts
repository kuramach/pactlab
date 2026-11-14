import { SNSClient, SubscribeCommand } from '@aws-sdk/client-sns';
import type { Logger } from '@pactlab/observability';

/**
 * Subscribe this environment's endpoint to its SES events topic (T-109), at startup. Idempotent:
 * for an endpoint already confirmed it returns the subscription; for one still pending, SNS sends
 * the confirmation again, so a confirmation that reached an older release is never lost.
 * Best-effort: a failure is logged and the API runs on (SES account suppression is the floor).
 */
export async function ensureEmailEventsSubscription(input: { region: string; topicArn: string; endpoint: string; logger: Logger }): Promise<void> {
  try {
    const result = await new SNSClient({ region: input.region }).send(new SubscribeCommand({ TopicArn: input.topicArn, Protocol: 'https', Endpoint: input.endpoint, ReturnSubscriptionArn: true }));
    input.logger.info({ topic: input.topicArn, pending: !result.SubscriptionArn || result.SubscriptionArn === 'pending confirmation' }, 'email events subscription ensured');
  } catch (error) {
    input.logger.warn({ topic: input.topicArn, errorClass: error instanceof Error ? error.name : 'unknown' }, 'email events subscription failed');
  }
}
