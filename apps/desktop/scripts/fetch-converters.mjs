// T-178b, T-178e: download the converters pinned in converters.lock.json for one Rust target triple,
// verify each archive's SHA-256 before anything is unpacked, unpack it with the platform's own tools,
// and place it where the app looks (src-tauri/vendor/<tool>, the layout `bundledTools` expects). Each
// tool's own licence files are copied into src-tauri/vendor/notices: a converter whose licence cannot
// be found is not bundled. An entry not yet pinned is not bundled either: the script says so and, with
// --allow-missing, carries on. src-tauri/vendor/BUNDLED.json records honestly what the installer holds.
// Usage: node scripts/fetch-converters.mjs <target-triple> [--allow-missing]
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [target, ...flags] = process.argv.slice(2);
if (!target) throw new Error('Name the Rust target triple');
const allowMissing = flags.includes('--allow-missing');
const lock = JSON.parse(readFileSync(join(root, 'converters.lock.json'), 'utf8'));
const vendor = join(root, 'src-tauri', 'vendor');
const notices = join(vendor, 'notices');
mkdirSync(notices, { recursive: true });

/** Every path under a folder, breadth first, to a bounded depth. */
function walk(folder, depth = 8) {
  const out = [];
  let level = [folder];
  for (let d = 0; d < depth && level.length > 0; d += 1) {
    const next = [];
    for (const dir of level) {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        out.push(path);
        if (statSync(path, { throwIfNoEntry: false })?.isDirectory() && !name.endsWith('.app')) next.push(path);
      }
    }
    level = next;
  }
  return out;
}

/** The platform's own unpacker for each archive kind the projects publish. */
function unpack(archive, kind, out) {
  if (kind === 'tar') execFileSync('tar', ['-xf', archive, '-C', out]);
  else if (kind === 'zip') execFileSync('unzip', ['-q', archive, '-d', out]);
  else if (kind === 'dmg') {
    const mount = mkdtempSync(join(tmpdir(), 'rinse-dmg-'));
    execFileSync('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, archive]);
    try {
      for (const name of readdirSync(mount)) if (name.endsWith('.app')) execFileSync('cp', ['-R', join(mount, name), out]);
    } finally {
      execFileSync('hdiutil', ['detach', mount]);
    }
  } else if (kind === 'msi') execFileSync('msiexec', ['/a', archive, '/qn', `TARGETDIR=${out}`]);
  else throw new Error(`unknown archive kind ${kind}`);
  // LibreOffice for Linux is a tarball of .deb packages: extract each, never install it.
  for (const deb of walk(out).filter((path) => path.endsWith('.deb'))) execFileSync('dpkg-deb', ['-x', deb, join(out, 'root')]);
}

const kindOf = (pathname) => (/\.(tar\.gz|tgz|tar\.xz)$/.test(pathname) ? 'tar' : pathname.endsWith('.zip') ? 'zip' : pathname.endsWith('.dmg') ? 'dmg' : pathname.endsWith('.msi') ? 'msi' : null);

/** Move the unpacked tool into the layout the app expects; null when the program is not in the archive. */
function settle(tool, unpacked, out) {
  const windows = target.includes('windows');
  const paths = walk(unpacked);
  if (tool === 'libreoffice') {
    const app = paths.find((path) => path.endsWith('LibreOffice.app'));
    if (app) return renameSync(app, join(out, 'LibreOffice.app')), true;
    const soffice = paths.find((path) => basename(path) === (windows ? 'soffice.exe' : 'soffice') && basename(dirname(path)) === 'program');
    if (!soffice) return false;
    // The whole office tree moves, so program/soffice keeps its share/ and other siblings.
    rmSync(out, { recursive: true, force: true });
    cpSync(dirname(dirname(soffice)), out, { recursive: true });
    return true;
  }
  const binary = paths.find((path) => basename(path) === (windows ? 'tesseract.exe' : 'tesseract') && !statSync(path).isDirectory());
  if (!binary) return false;
  mkdirSync(join(out, 'bin'), { recursive: true });
  cpSync(dirname(binary), join(out, 'bin'), { recursive: true });
  const tessdata = paths.find((path) => basename(path) === 'tessdata' && statSync(path).isDirectory());
  if (tessdata) cpSync(tessdata, join(out, 'tessdata'), { recursive: true });
  return true;
}

const bundled = {};
for (const tool of ['libreoffice', 'tesseract']) {
  const pin = lock[tool].targets[target];
  if (!pin?.url || !pin?.sha256) {
    const message = `${tool} is not pinned for ${target}: not bundled (the app fails closed with TOOL_MISSING)`;
    if (!allowMissing) throw new Error(message);
    process.stderr.write(`::warning title=Converter not bundled::${message}\n`);
    bundled[tool] = null;
    continue;
  }
  const url = new URL(pin.url);
  if (url.protocol !== 'https:') throw new Error(`${tool}: https only`);
  const kind = kindOf(url.pathname);
  if (!kind) throw new Error(`${tool}: no unpacker for ${url.pathname}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${tool}: download failed (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== pin.sha256) throw new Error(`${tool}: SHA-256 ${digest} is not the pinned ${pin.sha256}`);
  const work = mkdtempSync(join(tmpdir(), `rinse-${tool}-`));
  const archive = join(work, basename(url.pathname));
  writeFileSync(archive, bytes);
  const unpacked = join(work, 'unpacked');
  mkdirSync(unpacked);
  unpack(archive, kind, unpacked);
  const out = join(vendor, tool);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  // The licence texts come from the tool's own distribution, never retyped.
  const licences = walk(unpacked).filter((path) => /^(licen[cs]e|copying|notice)(\.[a-z]+)?$/i.test(basename(path)) && statSync(path).isFile());
  if (licences.length === 0) throw new Error(`${tool}: no licence file in the archive; not bundled`);
  for (const licence of licences.slice(0, 10)) cpSync(licence, join(notices, `${tool}-${basename(licence)}`));
  if (!settle(tool, unpacked, out)) throw new Error(`${tool}: the program is not in the archive`);
  rmSync(work, { recursive: true, force: true });
  bundled[tool] = { version: lock[tool].version, sha256: digest, licence: lock[tool].licence, source: pin.url };
}
writeFileSync(join(vendor, 'BUNDLED.json'), `${JSON.stringify({ target, bundled }, null, 2)}\n`);
if (!existsSync(join(notices, 'README.txt'))) writeFileSync(join(notices, 'README.txt'), 'Licence files of the converters bundled with this build, copied from each tool’s own distribution. See THIRD-PARTY-NOTICES.md.\n');
process.stdout.write(`${JSON.stringify({ target, bundled })}\n`);
