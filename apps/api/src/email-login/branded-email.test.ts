import { describe, expect, it } from 'vitest';
import { BrandedEmailSender, EMAIL_BLURB, emailAssets, renderEmailHtml } from './branded-email';
import type { EmailSender, OutboundEmail } from './email-sender';
import { emails } from './emails';

const assets = emailAssets('https://app.dev.pactlab.ai');

describe('branded emails', () => {
  it('takes the logo and website from the environment\'s always-on site', () => {
    expect(assets).toEqual({ logoUrl: 'https://dev.pactlab.ai/brand/pactlab-logo-email.png', siteUrl: 'https://dev.pactlab.ai' });
    expect(emailAssets('https://app.pactlab.ai')).toEqual({ logoUrl: 'https://pactlab.ai/brand/pactlab-logo-email.png', siteUrl: 'https://pactlab.ai' });
    // Locally the web app serves the logo itself.
    expect(emailAssets('http://localhost:3000').logoUrl).toBe('http://localhost:3000/brand/pactlab-logo-email.png');
  });

  it('shows the logo, a large code, and the note about Pactlab', () => {
    const message = emails.signInCode('a@example.com', '123456', 10);
    const html = renderEmailHtml(message.subject, message.content!, assets);
    expect(html).toContain('src="https://dev.pactlab.ai/brand/pactlab-logo-email.png"');
    expect(html).toContain('alt="Pactlab"');
    expect(html).toMatch(/letter-spacing:8px[^>]*>123456</);
    expect(html).toContain(EMAIL_BLURB.tagline);
    expect(html).toContain('href="https://dev.pactlab.ai"');
  });

  it('turns the main link into a button, http(s) only, and escapes everything a template carries', () => {
    const invite = emails.dealInvitation('a@example.com', { inviterName: 'Eve <script>', dealName: '"><img src=x onerror=alert(1)>', side: 'BIDDER', role: 'BIDDER', link: 'https://app.dev.pactlab.ai/invite/abc', days: 14 });
    const html = renderEmailHtml(invite.subject, invite.content!, assets);
    expect(html).toContain('href="https://app.dev.pactlab.ai/invite/abc"');
    expect(html).toContain('Open the invitation');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
    const unsafe = renderEmailHtml('x', { heading: 'x', paragraphs: [], action: { label: 'Click', url: 'javascript:alert(1)' } }, assets);
    expect(unsafe).not.toContain('javascript:');
    expect(unsafe).not.toContain('Click');
  });

  it('every template carries content mirroring its text (codes and links included)', () => {
    const all: OutboundEmail[] = [
      emails.signInCode('a@example.com', '111111', 10),
      emails.signupCode('a@example.com', '222222', 10),
      emails.dealInvitation('a@example.com', { inviterName: 'Ann', dealName: 'Project Atlas', side: 'BUYER', role: 'ANALYST', link: 'https://x.example/invite/t', days: 14 }),
      emails.listingInterestConfirm('a@example.com', { codename: 'Project Atlas', link: 'https://x.example/listings/confirm/t', days: 7 }),
      emails.listingInterestDeclined('a@example.com', { codename: 'Project Atlas', note: 'Strategic buyers only.' }),
      emails.signupExistingAccount('a@example.com', 'https://x.example/login'),
      emails.operatorNewSignup('ops@example.com', { organizationName: 'Acme', slug: 'acme', ownerName: 'Ann', ownerEmail: 'a@example.com', ssoRequested: false }),
      emails.organizationApproved('a@example.com', 'Acme', 'https://x.example/login'),
    ];
    for (const message of all) {
      expect(message.content, message.subject).toBeDefined();
      if (message.content?.code) expect(message.text).toContain(message.content.code);
      if (message.content?.action) expect(message.text).toContain(message.content.action.url);
    }
  });

  it('adds the HTML on the way out and leaves the text as it is', async () => {
    const sent: OutboundEmail[] = [];
    const inner: EmailSender = { name: 'capture', send: async (message) => void sent.push(message) };
    const message = emails.signInCode('a@example.com', '333333', 10);
    await new BrandedEmailSender(inner, assets).send(message);
    expect(sent[0]?.text).toBe(message.text);
    expect(sent[0]?.html).toContain('333333');
    // A message without content goes out as plain text.
    await new BrandedEmailSender(inner, assets).send({ to: 'a@example.com', subject: 'Plain', text: 'Hello' });
    expect(sent[1]?.html).toBeUndefined();
  });
});
