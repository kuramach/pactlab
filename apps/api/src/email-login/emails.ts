import type { OutboundEmail } from './email-sender';

/** Message templates. Plain, direct, no tracking links. */
export const emails = {
  signInCode(to: string, code: string, minutes: number): OutboundEmail {
    return {
      to,
      subject: 'Your Pactlab sign-in code',
      text: [
        `Your Pactlab sign-in code is ${code}.`,
        `It expires in ${minutes} minutes and works once.`,
        'If you did not try to sign in, ignore this email.',
      ].join('\n'),
    };
  },

  signupCode(to: string, code: string, minutes: number): OutboundEmail {
    return {
      to,
      subject: 'Confirm your Pactlab sign-up',
      text: [
        `Your Pactlab sign-up code is ${code}.`,
        `It expires in ${minutes} minutes and works once.`,
        'If you did not sign up for Pactlab, ignore this email.',
      ].join('\n'),
    };
  },

  /** An invitation to one pact (T-094 B12): who, which pact, which side and role; the link expires. */
  dealInvitation(to: string, invite: { inviterName: string; dealName: string; side: string; role: string; link: string; days: number }): OutboundEmail {
    const side = invite.side === 'SELLER' ? 'the seller side' : invite.side === 'ADVISOR' ? 'as an advisor' : invite.side === 'BIDDER' ? 'as a bidder' : 'the buyer side';
    return {
      to,
      subject: `${invite.inviterName} invited you to a pact on Pactlab`,
      text: [
        `${invite.inviterName} invited you to “${invite.dealName}” on Pactlab, ${side} (${invite.role.toLowerCase().replaceAll('_', ' ')}).`,
        `Open the invitation: ${invite.link}`,
        `You join this pact only — not the inviting company. The link works once and expires in ${invite.days} days.`,
        'If you were not expecting this, ignore this email.',
      ].join('\n'),
    };
  },

  /** Confirm a request for access left on a public deal page. The seller sees it only once confirmed. */
  listingInterestConfirm(to: string, request: { codename: string; link: string; days: number }): OutboundEmail {
    return {
      to,
      subject: `Confirm your request for ${request.codename}`,
      text: [
        `You asked for access to “${request.codename}” on Pactlab.`,
        `Confirm your email address to send the request to the seller: ${request.link}`,
        `The link works once and expires in ${request.days} days. If you did not ask, ignore this email.`,
      ].join('\n'),
    };
  },

  /** The seller decided not to go ahead with a request; their note, if any, is passed on. */
  listingInterestDeclined(to: string, request: { codename: string; note: string | null }): OutboundEmail {
    return {
      to,
      subject: `Your request for ${request.codename}`,
      text: [
        `The seller of “${request.codename}” is not taking your request further at this time.`,
        ...(request.note ? [`Their note: ${request.note}`] : []),
        'Thank you for your interest.',
      ].join('\n'),
    };
  },

  /** Sent instead of a code when the address already has an account. */
  signupExistingAccount(to: string, loginUrl: string): OutboundEmail {
    return {
      to,
      subject: 'You already have a Pactlab account',
      text: [
        'Someone tried to sign up for Pactlab with this address, which already has an account.',
        `To get in, log in at ${loginUrl}`,
        'If this was not you, no action is needed.',
      ].join('\n'),
    };
  },

  operatorNewSignup(
    to: string,
    signup: { organizationName: string; slug: string; ownerName: string; ownerEmail: string; ssoRequested: boolean },
  ): OutboundEmail {
    return {
      to,
      subject: `New Pactlab sign-up: ${signup.organizationName}`,
      text: [
        `${signup.ownerName} <${signup.ownerEmail}> signed up ${signup.organizationName}.`,
        signup.ssoRequested ? 'They asked for company SSO (Auth0) — see the SSO runbook.' : 'Sign-in: email codes.',
        '',
        `Approve:  pnpm org:approve ${signup.slug}`,
        `Reject:   pnpm org:reject ${signup.slug}`,
      ].join('\n'),
    };
  },

  organizationApproved(to: string, organizationName: string, loginUrl: string): OutboundEmail {
    return {
      to,
      subject: `${organizationName} is ready on Pactlab`,
      text: [`Your organization ${organizationName} is approved.`, `Log in at ${loginUrl} with this email address.`].join('\n'),
    };
  },
};
