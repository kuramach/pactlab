import type { OutboundEmail } from '../email-login/email-sender';

/** Contact-email messages (T-180), sent through the branded sender like every Pactlab email. */
export const contactEmails = {
  confirmAddress(to: string, code: string, minutes: number): OutboundEmail {
    return {
      to,
      subject: 'Confirm your email for Pactlab',
      text: [
        `Your Pactlab confirmation code is ${code}.`,
        `Enter it in your profile to have Pactlab notify you at this address. It expires in ${minutes} minutes and works once.`,
        'If you did not ask for this, ignore this email.',
      ].join('\n'),
      content: {
        heading: 'Confirm your email',
        paragraphs: ['Enter this code in your Pactlab profile so Pactlab can tell you when a pact needs you:'],
        code,
        footnote: `It expires in ${minutes} minutes and works once. If you did not ask for this, ignore this email.`,
      },
    };
  },

  /** To the old address after a change: says it happened, never what the new address is. */
  addressChanged(to: string, profileUrl: string): OutboundEmail {
    return {
      to,
      subject: 'Your Pactlab email was changed',
      text: [
        'The email Pactlab uses to notify you was just changed to a new address, confirmed with a code sent there.',
        `If this was not you, sign in and check your profile: ${profileUrl}`,
      ].join('\n'),
      content: {
        heading: 'Your email was changed',
        paragraphs: ['The email Pactlab uses to notify you was just changed to a new address, confirmed with a code sent there.', 'If this was not you, sign in and check your profile.'],
        action: { label: 'Open your profile', url: profileUrl },
      },
    };
  },
};
