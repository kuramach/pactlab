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
