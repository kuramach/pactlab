/**
 * Consumer mailbox providers. Sign-up asks for a work address so an
 * organization belongs to a company domain. Kept short and explicit.
 */
const FREE_MAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'ymail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'gmx.net',
  'mail.com',
  'yandex.com',
  'zoho.com',
]);

export function isFreeMailAddress(email: string): boolean {
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  return FREE_MAIL_DOMAINS.has(domain);
}
