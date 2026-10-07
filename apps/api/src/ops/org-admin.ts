/**
 * Operator commands for self-serve sign-ups (run as the schema owner):
 *   pnpm org:pending
 *   pnpm org:approve <slug>
 *   pnpm org:reject <slug>
 */
import pg from 'pg';
import { LocalFileEmailSender } from '../email-login/email-sender';
import { decide, listPending } from './organizations';

const [command, slug] = process.argv.slice(2);
const url = process.env['DATABASE_MIGRATION_URL'];
if (!url) {
  process.stderr.write('DATABASE_MIGRATION_URL is required (operator procedures run as the schema owner)\n');
  process.exit(1);
}
const appOrigin = process.env['APP_WEB_ORIGIN'] ?? 'http://localhost:3000';
const mailDir = process.env['APP_ENV'] === 'local' ? process.env['LOCAL_MAIL_DIR'] : undefined;
// Same rule as the API: only local runs have a delivery channel today.
const sender = mailDir ? new LocalFileEmailSender(mailDir) : null;

const client = new pg.Client({ connectionString: url, options: '-c TimeZone=UTC' });
await client.connect();
try {
  if (command === 'pending') {
    const pending = await listPending(client);
    if (pending.length === 0) process.stdout.write('No organizations waiting for approval.\n');
    for (const org of pending) {
      process.stdout.write(
        `${org.slug}  ${org.name}  owner: ${org.owners || '—'}  ${org.ssoRequested ? 'SSO requested  ' : ''}signed up ${org.createdAt.toISOString()}\n`,
      );
    }
  } else if ((command === 'approve' || command === 'reject') && slug) {
    const outcome = await decide(client, slug, command, { sender, loginUrl: new URL('/login', appOrigin).toString() });
    if (outcome.kind === 'not-found') {
      process.stderr.write(`No organization with slug ${slug}\n`);
      process.exitCode = 1;
    } else if (outcome.kind === 'unchanged') {
      process.stdout.write(`${slug} is already ${outcome.status}; nothing changed.\n`);
    } else {
      process.stdout.write(`${outcome.name} ${command === 'approve' ? 'approved' : 'rejected'}.\n`);
      if (outcome.notified.length) process.stdout.write(`Told: ${outcome.notified.join(', ')}\n`);
      if (outcome.notDelivered.length)
        process.stdout.write(`No email delivery configured — tell them yourself: ${outcome.notDelivered.join(', ')}\n`);
    }
  } else {
    process.stderr.write('Usage: org:pending | org:approve <slug> | org:reject <slug>\n');
    process.exitCode = 1;
  }
} finally {
  await client.end();
}
