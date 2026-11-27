// T-178b: download the converters pinned in converters.lock.json for one Rust target triple, verify
// each archive's SHA-256 before anything is unpacked, and place it under src-tauri/vendor/<tool>.
// An entry not yet pinned is not bundled: the script says so and, with --allow-missing, carries on,
// writing src-tauri/vendor/BUNDLED.json so the release records honestly what the installer holds.
// Usage: node scripts/fetch-converters.mjs <target-triple> [--allow-missing]
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [target, ...flags] = process.argv.slice(2);
if (!target) throw new Error('Name the Rust target triple');
const allowMissing = flags.includes('--allow-missing');
const lock = JSON.parse(readFileSync(join(root, 'converters.lock.json'), 'utf8'));
const vendor = join(root, 'src-tauri', 'vendor');
mkdirSync(vendor, { recursive: true });
const bundled = {};
for (const tool of ['libreoffice', 'tesseract']) {
  const pin = lock[tool].targets[target];
  if (!pin?.url || !pin?.sha256) {
    const message = `${tool} is not pinned for ${target}: not bundled`;
    if (!allowMissing) throw new Error(message);
    process.stderr.write(`::warning::${message}\n`);
    bundled[tool] = null;
    continue;
  }
  const url = new URL(pin.url);
  if (url.protocol !== 'https:') throw new Error(`${tool}: https only`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${tool}: download failed (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== pin.sha256) throw new Error(`${tool}: SHA-256 ${digest} is not the pinned ${pin.sha256}`);
  const archive = join(vendor, `${tool}.download`);
  writeFileSync(archive, bytes);
  const out = join(vendor, tool);
  mkdirSync(out, { recursive: true });
  // The platform's own unpacker; .dmg and .msi need the platform tools and are handled by the workflow.
  if (/\.(tar\.gz|tgz|tar\.xz)$/.test(url.pathname)) execFileSync('tar', ['-xf', archive, '-C', out]);
  else if (url.pathname.endsWith('.zip')) execFileSync('unzip', ['-q', archive, '-d', out]);
  else throw new Error(`${tool}: unpack ${url.pathname} with the platform's tools before bundling`);
  bundled[tool] = { version: lock[tool].version, sha256: digest, licence: lock[tool].licence };
}
writeFileSync(join(vendor, 'BUNDLED.json'), `${JSON.stringify({ target, bundled }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ target, bundled })}\n`);
