import { readableOnWhite } from '@pactlab/domain';
import type { EmailBrand, EmailContent, EmailSender, OutboundEmail } from './email-sender';

/**
 * Pactlab-branded HTML for every outgoing email: logo, the message (a large code or a
 * button where it has one), and a short note about Pactlab at the bottom. Table layout and
 * inline styles, which is what mail apps render reliably; everything from a template is
 * escaped. The plain-text body is unchanged and always sent too.
 */
const NAVY = '#081127';
const PACTLAB_INDIGO = '#6978ff';
const MUTED = '#5b6478';
const PAGE = '#f7f9fc';
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** The short note about Pactlab at the bottom of every email. */
export const EMAIL_BLURB = {
  tagline: 'Test the pact before you sign it.',
  text: 'Pactlab checks every claim in an M&A deal against the evidence: revenue, code, contracts, people. Every finding is cited, and the decisions stay with you.',
};

export const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

/** Only http(s) links become buttons. */
const safeUrl = (url: string) => (/^https?:\/\//i.test(url) ? escapeHtml(url) : null);

/**
 * Where the logo and the website are, from the app's origin: an environment's app at
 * `app.<host>` has its site, always on, at `<host>`; anything else (local) serves both itself.
 */
export function emailAssets(appOrigin: string): { logoUrl: string; siteUrl: string } {
  const url = new URL(appOrigin);
  const site = url.hostname.startsWith('app.') ? `${url.protocol}//${url.hostname.slice(4)}` : url.origin;
  return { logoUrl: `${site}/brand/pactlab-logo-email.png`, siteUrl: site };
}

export function renderEmailHtml(subject: string, content: EmailContent, assets: { logoUrl: string; siteUrl: string }, brand?: EmailBrand): string {
  // An organization's email (T-123): its logo or name on top, its accent on buttons (darkened until white reads on it).
  const INDIGO = brand?.accentColor ? readableOnWhite(brand.accentColor).color : PACTLAB_INDIGO;
  const brandLogo = brand?.logoUrl ? safeUrl(brand.logoUrl) : null;
  const header = brand
    ? brandLogo
      ? `<img src="${brandLogo}" height="40" alt="${escapeHtml(brand.name)}" style="display:block;border:0;height:40px;width:auto;max-width:200px">`
      : `<span style="font:800 22px/1.2 ${FONT};color:${NAVY}">${escapeHtml(brand.name)}</span>`
    : `<a href="${escapeHtml(assets.siteUrl)}"><img src="${escapeHtml(assets.logoUrl)}" width="140" height="53" alt="Pactlab" style="display:block;border:0;height:auto"></a>`;
  const paragraph = (text: string) => `<p style="margin:0 0 16px;font:15px/1.6 ${FONT};color:${NAVY}">${escapeHtml(text)}</p>`;
  const action = content.action ? safeUrl(content.action.url) : null;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:${PAGE}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE}">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 0 20px">${header}</td></tr>
<tr><td style="background:#ffffff;border:1px solid #e3e7f0;border-radius:12px;padding:32px">
<h1 style="margin:0 0 20px;font:700 22px/1.3 ${FONT};color:${NAVY}">${escapeHtml(content.heading)}</h1>
${content.paragraphs.map(paragraph).join('\n')}
${content.code ? `<p style="margin:8px 0 24px;font:700 32px/1 ${FONT};letter-spacing:8px;color:${NAVY};background:#f0f2ff;border-radius:8px;padding:16px;text-align:center">${escapeHtml(content.code)}</p>` : ''}
${action && content.action ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="background:${INDIGO};border-radius:8px"><a href="${action}" style="display:inline-block;padding:12px 22px;font:600 15px/1 ${FONT};color:#ffffff;text-decoration:none">${escapeHtml(content.action.label)}</a></td></tr></table><p style="margin:0 0 16px;font:13px/1.5 ${FONT};color:${MUTED}">Or paste this link into your browser: <a href="${action}" style="color:${INDIGO};word-break:break-all">${action}</a></p>` : ''}
${(content.links ?? [])
  .map((link) => ({ link, url: safeUrl(link.url) }))
  .filter((entry) => entry.url)
  .map(
    ({ link, url }) =>
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 6px"><tr><td style="background:${INDIGO};border-radius:8px"><a href="${url}" style="display:inline-block;padding:12px 22px;font:600 15px/1 ${FONT};color:#ffffff;text-decoration:none">${escapeHtml(link.label)}</a></td></tr></table><p style="margin:0 0 18px;font:13px/1.5 ${FONT};color:${MUTED}">${escapeHtml(link.detail)}</p>`,
  )
  .join('\n')}
${content.list ? `<p style="margin:16px 0 8px;font:700 15px/1.4 ${FONT};color:${NAVY}">${escapeHtml(content.list.heading)}</p><ol style="margin:0 0 16px;padding-left:20px;font:14px/1.6 ${FONT};color:${NAVY}">${content.list.items.map((item) => `<li style="margin:0 0 4px">${escapeHtml(item)}</li>`).join('')}</ol>` : ''}
${content.footnote ? `<p style="margin:16px 0 0;font:13px/1.5 ${FONT};color:${MUTED}">${escapeHtml(content.footnote)}</p>` : ''}
</td></tr>
<tr><td style="padding:24px 8px 0">
${brand ? `<p style="margin:0 0 8px;font:600 12px/1.4 ${FONT};color:${MUTED}">Sent with Pactlab for ${escapeHtml(brand.name)}</p>` : ''}<p style="margin:0 0 6px;font:700 14px/1.4 ${FONT};color:${NAVY}">${escapeHtml(EMAIL_BLURB.tagline)}</p>
<p style="margin:0 0 12px;font:13px/1.6 ${FONT};color:${MUTED}">${escapeHtml(EMAIL_BLURB.text)} <a href="${escapeHtml(assets.siteUrl)}" style="color:${INDIGO}">Learn more</a></p>
<p style="margin:0;font:12px/1.5 ${FONT};color:${MUTED}">${escapeHtml(content.reason ?? 'You received this email because of an action on your Pactlab account.')}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** Adds the branded HTML to every message that describes its content; the text is sent as it is. */
export class BrandedEmailSender implements EmailSender {
  readonly name: string;

  constructor(
    private readonly inner: EmailSender,
    private readonly assets: { logoUrl: string; siteUrl: string },
  ) {
    this.name = inner.name;
  }

  send(message: OutboundEmail): Promise<void> {
    if (!message.content || message.html) return this.inner.send(message);
    return this.inner.send({ ...message, html: renderEmailHtml(message.subject, message.content, this.assets, message.brand) });
  }
}
