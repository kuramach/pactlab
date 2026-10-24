import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { MAIL_DIR } from './env';

/**
 * The newest one-time code the API wrote to LOCAL_MAIL_DIR for an address —
 * the same mail files `pnpm login:code` reads. Waits for a code newer than
 * `after` so a test never reuses an older one.
 */
export async function latestCode(address: string, after: number): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(
      () => {
        const files = readdirSync(MAIL_DIR)
          .filter((name) => name.endsWith('.txt'))
          .map((name) => ({ path: join(MAIL_DIR, name), at: statSync(join(MAIL_DIR, name)).mtimeMs }))
          .filter((file) => file.at >= after)
          .sort((a, b) => b.at - a.at);
        for (const file of files) {
          const text = readFileSync(file.path, 'utf8');
          if (/^To: (.+)$/m.exec(text)?.[1]?.trim().toLowerCase() !== address) continue;
          code = /\b(\d{6})\b/.exec(text)?.[1];
          if (code) return true;
        }
        return false;
      },
      { message: `a sign-in code for ${address}`, timeout: 15_000 },
    )
    .toBe(true);
  return code ?? '';
}
