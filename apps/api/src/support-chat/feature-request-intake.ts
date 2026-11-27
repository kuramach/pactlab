import type { FeatureRequestIntakeItem } from '@pactlab/contracts';
import type { EmailSender } from '../email-login/email-sender';
import { transcriptText } from './handoff-email';

/**
 * Where a confirmed feature request goes (T-175 hands off; T-176 builds the proposal store and triage on
 * this port). Until T-176 lands, a request is emailed to the team, so none is ever dropped.
 */
export interface FeatureRequestIntake {
  submit(item: FeatureRequestIntakeItem): Promise<void>;
}

export class EmailFeatureRequestIntake implements FeatureRequestIntake {
  constructor(
    private readonly sender: EmailSender,
    private readonly teamEmail: string,
  ) {}

  async submit(item: FeatureRequestIntakeItem): Promise<void> {
    const from = item.requester.kind === 'VISITOR' ? `a site visitor (${item.requester.email})` : `a signed-in user (user ${item.requester.userId}, organization ${item.requester.organizationId}${item.requester.email ? `, ${item.requester.email}` : ''})`;
    const text = [`Feature request from ${from}, confirmed in the help chat.`, '', `Request: ${item.summary}`, `Where: ${item.surface === 'SITE' ? 'pactlab.ai' : 'the app'} ${item.page} (${item.locale})`, '', 'Conversation:', transcriptText(item.transcript)].join('\n');
    await this.sender.send({ to: this.teamEmail, subject: `Feature request: ${item.summary.slice(0, 80)}`, text });
  }
}
