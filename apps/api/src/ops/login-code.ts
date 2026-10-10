/**
 * Local only: print the newest sign-in or sign-up code written to
 * LOCAL_MAIL_DIR, so you don't have to dig through the hidden `.data` folder.
 *
 *   pnpm login:code                       newest code for any address
 *   pnpm login:code reviewer@charlie.example
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const appEnv = process.env['APP_ENV'];
const mailDir = process.env['LOCAL_MAIL_DIR'];
if (appEnv !== 'local' || !mailDir) {
  process.stderr.write('login:code works only locally (APP_ENV=local) with LOCAL_MAIL_DIR set.\n');
  process.exit(1);
}

// The API writes mail relative to its own folder (apps/api).
const dir = resolve(new URL('../..', import.meta.url).pathname, mailDir);
const address = process.argv[2]?.trim().toLowerCase();

let files: string[] = [];
try {
  files = (await readdir(dir)).filter((name) => name.endsWith('.txt'));
} catch {
  process.stderr.write(`No mail yet in ${dir}. Click “Send code” on the login page first.\n`);
  process.exit(1);
}
const dated = await Promise.all(files.map(async (name) => ({ name, at: (await stat(join(dir, name))).mtimeMs })));
dated.sort((a, b) => b.at - a.at);

for (const { name, at } of dated) {
  const text = await readFile(join(dir, name), 'utf8');
  const to = /^To: (.+)$/m.exec(text)?.[1]?.trim().toLowerCase();
  if (address && to !== address) continue;
  const code = /\b(\d{6})\b/.exec(text)?.[1];
  if (!code) continue;
  const minutes = Math.floor((Date.now() - at) / 60_000);
  process.stdout.write(`${code}  for ${to}  (sent ${minutes} min ago${minutes >= 10 ? ' — expired, send a new one' : ''})\n`);
  process.exit(0);
}
process.stderr.write(`No code found${address ? ` for ${address}` : ''}. Click “Send code” on the login page first.\n`);
process.exit(1);
