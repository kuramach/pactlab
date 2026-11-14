import { describe, expect, it } from 'vitest';
import { BrandedEmailSender, EMAIL_BLURB, emailAssets, renderEmailHtml } from './branded-email';
import { emailBrand } from '../brand/email-brand';
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

describe('the shared-demo invitation (T-113)', () => {
  const invite = emails.demoInvite('jane@acme.example', {
    recipientName: 'Jane',
    sharerName: 'Kumar',
    sharerEmail: 'kumar@pactlab.ai',
    note: 'Great to meet you <today>.',
    buyerUrl: 'https://app.pactlab.ai/demo/buyer-token',
    sellerUrl: 'https://app.pactlab.ai/demo/seller-token',
    endsAt: new Date('2026-11-20T12:00:00Z'),
  });
  const html = renderEmailHtml(invite.subject, invite.content!, { logoUrl: 'https://pactlab.ai/brand/pactlab-logo-email.png', siteUrl: 'https://pactlab.ai' });

  it('says who sent it, what Pactlab is, which link to open, what to try, until when and whom to ask', () => {
    expect(invite.subject).toBe('Kumar shared a Pactlab demo with you');
    for (const part of ['Hi Jane,', 'deal platform for private equity and corporate development', 'synthetic', 'Open as the buyer: https://app.pactlab.ai/demo/buyer-token', 'Open as the seller: https://app.pactlab.ai/demo/seller-token', 'Take the tour', '2026-11-20 12:00 UTC', 'kumar@pactlab.ai', 'No sign-up needed']) {
      expect(invite.text, part).toContain(part);
    }
  });

  it('renders Pactlab-branded HTML with both buttons, the list, and why it was received; the note is escaped', () => {
    expect(html).toContain('pactlab-logo-email.png');
    expect(html).toContain('href="https://app.pactlab.ai/demo/buyer-token"');
    expect(html).toContain('href="https://app.pactlab.ai/demo/seller-token"');
    expect(html).toContain('In ten minutes, try');
    expect(html).toContain('because Kumar at Pactlab shared a demo with you');
    expect(html).toContain('&lt;today&gt;');
    expect(html).not.toContain('<today>');
  });
});

describe('emails sent for an organization (T-123)', () => {
  const invite = emails.dealInvitation('a@example.com', { inviterName: 'Ana', dealName: 'Project Kite', side: 'SELLER', role: 'TARGET_CONTRIBUTOR', link: 'https://app.dev.pactlab.ai/invite/abc', days: 14 });

  it('carries the organization’s logo and accent, still says Pactlab sent it, and escapes its name', () => {
    const html = renderEmailHtml(invite.subject, invite.content!, assets, { name: 'Acme <b>Capital</b>', logoUrl: 'https://app.dev.pactlab.ai/login/acme/logo', accentColor: '#ffd400' });
    expect(html).toContain('src="https://app.dev.pactlab.ai/login/acme/logo"');
    expect(html).not.toContain('alt="Pactlab"');
    expect(html).toContain('Sent with Pactlab for Acme &lt;b&gt;Capital&lt;/b&gt;');
    expect(html).toContain(EMAIL_BLURB.tagline);
    // A yellow accent is darkened until white button text reads on it.
    expect(html).not.toContain('background:#ffd400');
    expect(html).not.toContain('background:#6978ff');
  });

  it('prints the name when there is no raster logo, and refuses a non-http logo', () => {
    const html = renderEmailHtml(invite.subject, invite.content!, assets, { name: 'Acme Capital', logoUrl: 'javascript:alert(1)', accentColor: null });
    expect(html).not.toContain('javascript:');
    expect(html).toMatch(/font:800 22px[^>]*>Acme Capital</);
    expect(html).toContain('background:#6978ff');
  });

  it('builds the brand from the kit: none on the Pactlab look, no SVG logo in mail', () => {
    expect(emailBrand({ name: 'Acme', slug: 'acme' }, { source: 'DEFAULT', accentColor: '#112233', logoContentType: 'image/png' }, 'https://app.pactlab.ai')).toBeNull();
    expect(emailBrand({ name: 'Acme', slug: 'acme' }, { source: 'EDITED', accentColor: null, logoContentType: 'image/svg+xml' }, 'https://app.pactlab.ai')?.logoUrl).toBeNull();
    expect(emailBrand({ name: 'Acme', slug: 'acme' }, { source: 'EXTRACTED', accentColor: null, logoContentType: 'image/png' }, 'https://app.pactlab.ai')?.logoUrl).toBe('https://app.pactlab.ai/login/acme/logo');
  });
});
