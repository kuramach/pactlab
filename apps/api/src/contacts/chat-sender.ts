import { ChannelSendError, type ChatMessage, type SecretStore, type SlackApp, type TeamsBot } from '@pactlab/connectors';
import type { ChatTarget } from '@pactlab/db';
import { CHAT_BUTTONS, channelMessage, type ChannelMessageKind } from '@pactlab/domain';

/**
 * Sends one Slack or Teams direct message to a linked person (T-181). Shared by the notification
 * dispatcher and the profile's test message. The Slack bot token is read from the credential store at
 * send time and never kept; the words are the shared, content-free template.
 */
export class ChatSender {
  constructor(
    readonly slack: SlackApp | null,
    readonly teams: TeamsBot | null,
    private readonly secrets: SecretStore | null,
  ) {}

  get enabled(): boolean {
    return this.slack !== null || this.teams !== null;
  }

  async send(target: ChatTarget, message: ChatMessage): Promise<void> {
    const [tenant, member] = target.handle.split(':');
    if (!tenant || !member) throw new ChannelSendError('ChatHandleInvalid');
    if (target.kind === 'SLACK') {
      if (!this.slack) throw new ChannelSendError('SlackOff');
      await this.slack.sendDirect(await this.botToken(target.credentialRef), member, message);
      return;
    }
    if (!this.teams) throw new ChannelSendError('TeamsOff');
    if (!target.serviceUrl || !target.conversationId) throw new ChannelSendError('TeamsNoConversation', true);
    await this.teams.send({ tenantId: tenant, aadObjectId: member, serviceUrl: target.serviceUrl, conversationId: target.conversationId }, message);
  }

  async botToken(credentialRef: string | null): Promise<string> {
    if (!credentialRef || !this.secrets) throw new ChannelSendError('SlackNoToken');
    try {
      return await this.secrets.get(credentialRef);
    } catch {
      throw new ChannelSendError('SlackNoToken');
    }
  }
}

/** One Slack or Teams message from the shared words: "Pactlab:" first, one button, no deal content. */
export function chatMessage(kind: Extract<ChannelMessageKind, 'ACT_NOW' | 'TEST'>, link: string): ChatMessage {
  return { text: channelMessage(kind, { link }), action: { kind: 'LINK', label: CHAT_BUTTONS.OPEN, url: link } };
}
