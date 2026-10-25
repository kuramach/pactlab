/**
 * Make a person a platform operator (the admin console, T-072), or revoke it.
 * Runs as the schema owner, like `pnpm org:*`:
 *   pnpm ops:operator <email>
 *   pnpm ops:operator <email> --revoke
 */
import pg from 'pg';

const [email, flag] = process.argv.slice(2);
const url = process.env['DATABASE_MIGRATION_URL'];
if (!url || !email) {
  process.stderr.write('Usage: pnpm ops:operator <email> [--revoke]  (needs DATABASE_MIGRATION_URL)\n');
  process.exit(1);
}
const grant = flag !== '--revoke';
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const updated = await client.query<{ id: string; organization_id: string | null }>(
    `UPDATE users u SET platform_operator = $2 WHERE u.email = lower($1)
     RETURNING u.id, (SELECT m.organization_id FROM organization_memberships m WHERE m.user_id = u.id ORDER BY m.created_at LIMIT 1) AS organization_id`,
    [email.trim(), grant],
  );
  const user = updated.rows[0];
  if (!user) {
    process.stderr.write(`No user with email ${email}\n`);
    process.exitCode = 1;
  } else {
    if (user.organization_id) {
      await client.query(
        `INSERT INTO audit_events (id, organization_id, deal_id, actor_user_id, action, target_type, target_id, outcome)
         VALUES (uuidv7(), $1, NULL, NULL, $2, 'user', $3, 'SUCCEEDED')`,
        [user.organization_id, grant ? 'operator.granted' : 'operator.revoked', user.id],
      );
    }
    process.stdout.write(`${email} is ${grant ? 'now' : 'no longer'} a platform operator.\n`);
  }
} finally {
  await client.end();
}
