import { EMAIL_COPY, type EmailCopy, type EmailLocale, type InvitationRole, type InvitationSide } from './email-catalog';
import type { OutboundEmail } from './email-sender';

/** A one-time code email (sign-in or sign-up) in the recipient's language. */
function codeEmail(to: string, code: string, minutes: number, locale: EmailLocale, copy: EmailCopy['signInCode']): OutboundEmail {
  return {
    to,
    subject: copy.subject,
    locale,
    text: [copy.textCode(code), copy.expires(minutes), copy.ignore].join('\n'),
    content: { heading: copy.heading, paragraphs: [copy.enter], code, footnote: `${copy.expires(minutes)} ${copy.ignore}` },
  };
}

/**
 * Message templates. Plain, direct, no tracking links. `text` is what is said; `content`
 * mirrors it for the branded HTML version (BrandedEmailSender adds the logo and footer).
 */
export const emails = {
  signInCode(to: string, code: string, minutes: number, locale: EmailLocale = 'en'): OutboundEmail {
    return codeEmail(to, code, minutes, locale, EMAIL_COPY[locale].signInCode);
  },

  signupCode(to: string, code: string, minutes: number, locale: EmailLocale = 'en'): OutboundEmail {
    return codeEmail(to, code, minutes, locale, EMAIL_COPY[locale].signupCode);
  },

  /** An invitation to one pact (T-094 B12): who, which pact, which side and role; the link expires. In the invitee's language (T-174). */
  dealInvitation(
    to: string,
    invite: { inviterName: string; dealName: string; side: string; role: string; link: string; days: number },
    locale: EmailLocale = 'en',
  ): OutboundEmail {
    const copy = EMAIL_COPY[locale].invitation;
    const side = copy.sides[invite.side as InvitationSide] ?? copy.sides.BUYER;
    const role = copy.roles[invite.role as InvitationRole] ?? invite.role.toLowerCase().replaceAll('_', ' ');
    // Bidders and investors are named by their side alone.
    const shownRole = invite.role === 'BIDDER' || invite.role === 'INVESTOR' ? null : role;
    return {
      to,
      subject: copy.subject(invite.inviterName),
      locale,
      text: [
        copy.body(invite.inviterName, invite.dealName, side, role),
        `${copy.open}: ${invite.link}`,
        `${copy.onlyThisPact} ${copy.expires(invite.days)}`,
        copy.ignore,
      ].join('\n'),
      content: {
        heading: copy.heading(invite.dealName),
        paragraphs: [copy.body(invite.inviterName, invite.dealName, side, shownRole), copy.onlyThisPact],
        action: { label: copy.open, url: invite.link },
        footnote: `${copy.expires(invite.days)} ${copy.ignore}`,
      },
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
      content: {
        heading: 'Confirm your request',
        paragraphs: [`You asked for access to “${request.codename}” on Pactlab. Confirm your email address to send the request to the seller.`],
        action: { label: 'Confirm my request', url: request.link },
        footnote: `The link works once and expires in ${request.days} days. If you did not ask, ignore this email.`,
      },
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
      content: {
        heading: `About your request for ${request.codename}`,
        paragraphs: [`The seller of “${request.codename}” is not taking your request further at this time.`, ...(request.note ? [`Their note: ${request.note}`] : []), 'Thank you for your interest.'],
      },
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
      content: {
        heading: 'You already have an account',
        paragraphs: ['Someone tried to sign up for Pactlab with this address, which already has an account.'],
        action: { label: 'Log in', url: loginUrl },
        footnote: 'If this was not you, no action is needed.',
      },
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
      content: {
        heading: `New sign-up: ${signup.organizationName}`,
        paragraphs: [
          `${signup.ownerName} <${signup.ownerEmail}> signed up ${signup.organizationName}.`,
          signup.ssoRequested ? 'They asked for company SSO (Auth0) — see the SSO runbook.' : 'Sign-in: email codes.',
          `Approve: pnpm org:approve ${signup.slug}`,
          `Reject: pnpm org:reject ${signup.slug}`,
        ],
      },
    };
  },

  /** A public data source live uses stopped (or started again) answering live (T-137 follow-up). */
  operatorSourceAlert(to: string, alert: { source: string; environment: string; ok: boolean; detail: string | null }): OutboundEmail {
    const lines = alert.ok
      ? [`${alert.source} is reachable from ${alert.environment} again.`, 'Foresight uses the published forecasts again.']
      : [
          `${alert.source} is not reachable from ${alert.environment}${alert.detail ? ` (${alert.detail})` : ''}.`,
          'Foresight is using AI forecasts only until it is back; pacts show a note saying so.',
          'Admin → Health shows the status and has Check now. Runbook: docs/runbooks/connector-outage.md.',
        ];
    return {
      to,
      subject: alert.ok ? `Pactlab ${alert.environment}: ${alert.source} is back` : `Pactlab ${alert.environment}: ${alert.source} unreachable`,
      text: lines.join('\n'),
      content: { heading: alert.ok ? `${alert.source} is back` : `${alert.source} unreachable`, paragraphs: lines },
    };
  },

  organizationApproved(to: string, organizationName: string, loginUrl: string): OutboundEmail {
    return {
      to,
      subject: `${organizationName} is ready on Pactlab`,
      text: [`Your organization ${organizationName} is approved.`, `Log in at ${loginUrl} with this email address.`].join('\n'),
      content: {
        heading: `${organizationName} is ready`,
        paragraphs: [`Your organization ${organizationName} is approved. Log in with this email address.`],
        action: { label: 'Log in to Pactlab', url: loginUrl },
      },
    };
  },

  /** A passkey was added to or removed from the account (T-108): the owner always hears of it. */
  passkeyChanged(to: string, change: 'added' | 'removed', name: string, settingsUrl: string): OutboundEmail {
    const line = change === 'added' ? `A passkey, "${name}", was added to your Pactlab sign-in.` : `The passkey "${name}" was removed from your Pactlab sign-in.`;
    const ifNot = 'If this was not you, sign in with an email code, remove any passkey you do not recognise in Settings, and tell your organization owner.';
    return {
      to,
      subject: change === 'added' ? 'A passkey was added to your Pactlab sign-in' : 'A passkey was removed from your Pactlab sign-in',
      text: [line, ifNot, `Settings: ${settingsUrl}`].join('\n'),
      content: {
        heading: change === 'added' ? 'Passkey added' : 'Passkey removed',
        paragraphs: [line],
        action: { label: 'Review your passkeys', url: settingsUrl },
        footnote: ifNot,
      },
    };
  },

  /**
   * A shared demo (T-113), sent from the admin console: what Pactlab is, which link to open, what to
   * try first, how long it stays open and whom to ask. No sign-up; the links are the access.
   */
  demoInvite(
    to: string,
    invite: { recipientName: string | null; sharerName: string; sharerEmail: string | null; note: string | null; buyerUrl: string; sellerUrl: string; endsAt: Date },
  ): OutboundEmail {
    const until = `${invite.endsAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
    const greeting = invite.recipientName ? `Hi ${invite.recipientName},` : 'Hello,';
    const about =
      'Pactlab is the deal platform for private equity and corporate development: diligence, valuation, terms and closing in one place, with every number traced to its source and every decision made by a person.';
    const synthetic = 'This demo is a full copy of Pactlab filled with synthetic deals. Every company, person and figure is invented, so click anything and change what you like.';
    const buyer = 'Start here: the deal team’s view — findings with their evidence, the valuation (Sextant), terms, the investment committee and closing.';
    const seller = 'The same deals from the company being acquired: what the buyer shares with you, and what stays private to them.';
    const tryFirst = [
      'Open a pact and press “Take the tour” at the top: it walks you through the deal step by step.',
      'Findings: open one and follow it back to the document, row or commit behind it.',
      'Valuation → Scenarios and bridge: see how accepted risks move the price.',
      'Proposed terms and Closing: the counter-offer, sign-off and funds confirmation.',
      'Reports: download the pact report as a PDF.',
    ];
    const contact = invite.sharerEmail ? `Questions: reply to ${invite.sharerName} at ${invite.sharerEmail}.` : `Questions: reply to ${invite.sharerName}.`;
    const footnote = `No sign-up needed. The links work until ${until}; then the demo resets to its original data. Sending emails, e-signature and billing are switched off in the demo. ${contact}`;
    return {
      to,
      subject: `${invite.sharerName} shared a Pactlab demo with you`,
      text: [
        greeting,
        '',
        ...(invite.note ? [invite.note, ''] : []),
        about,
        synthetic,
        '',
        `Open as the buyer: ${invite.buyerUrl}`,
        buyer,
        '',
        `Open as the seller: ${invite.sellerUrl}`,
        seller,
        '',
        'In ten minutes, try:',
        ...tryFirst.map((item, index) => `${index + 1}. ${item}`),
        '',
        footnote,
      ].join('\n'),
      content: {
        heading: 'Your Pactlab demo is ready',
        paragraphs: [greeting, ...(invite.note ? [invite.note] : []), about, synthetic],
        links: [
          { label: 'Open as the buyer', url: invite.buyerUrl, detail: buyer },
          { label: 'Open as the seller', url: invite.sellerUrl, detail: seller },
        ],
        list: { heading: 'In ten minutes, try', items: tryFirst },
        footnote,
        reason: `You received this email because ${invite.sharerName} at Pactlab shared a demo with you.`,
      },
    };
  },
};
