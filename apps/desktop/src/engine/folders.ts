import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { RINSE_MANIFEST_FILE, rinsePathSchema, type RinseManifest } from '@pactlab/contracts';
import { isClutter } from '@pactlab/domain';

/** Largest single file Rinse reads into a set. */
export const MAX_RINSE_FILE_BYTES = 200 * 1024 * 1024;

/** Every file under a folder, recursively, by its path relative to the folder ('/'-separated). Symlinks are not followed. */
export async function readFolder(root: string): Promise<{ path: string; bytes: Uint8Array }[]> {
  const out: { path: string; bytes: Uint8Array }[] = [];
  async function walk(folder: string): Promise<void> {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const absolute = join(folder, entry.name);
      const path = relative(root, absolute).split(sep).join('/');
      if (isClutter(path)) continue;
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && (await stat(absolute)).size <= MAX_RINSE_FILE_BYTES) out.push({ path, bytes: new Uint8Array(await readFile(absolute)) });
    }
  }
  await walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Watch-folder mode: files added to the working folder queue themselves. Events are debounced, so a file
 * still being copied is read once it has settled.
 */
export function watchFolder(root: string, onFile: (path: string, bytes: Uint8Array) => void, settleMs = 750): FSWatcher {
  const timers = new Map<string, NodeJS.Timeout>();
  return watch(root, { recursive: true }, (_event, name) => {
    if (!name) return;
    const path = name.split(sep).join('/');
    if (isClutter(path)) return;
    clearTimeout(timers.get(path));
    timers.set(
      path,
      setTimeout(() => {
        timers.delete(path);
        void (async () => {
          try {
            const absolute = join(root, name);
            const info = await stat(absolute);
            if (info.isFile() && info.size <= MAX_RINSE_FILE_BYTES) onFile(path, new Uint8Array(await readFile(absolute)));
          } catch {
            // silent-ok: a file removed before it settled was never added.
          }
        })();
      }, settleMs),
    );
  });
}

/**
 * Where the finished set goes. The destination is the seller's own: a local or network folder, or their
 * own OneDrive, Google Drive or Box through their own sign-in in the app (a separate auth from the
 * Pactlab login). Pactlab needs no write access to anyone's cloud on this path.
 */
export interface RinseDestination {
  readonly kind: 'FOLDER' | 'ONEDRIVE' | 'GOOGLE_DRIVE' | 'BOX';
  write(files: ReadonlyMap<string, Uint8Array>, manifest: RinseManifest): Promise<{ location: string; written: number }>;
}

/** A local or network folder. The set goes into a new folder of its own; nothing existing is overwritten. */
export class FolderDestination implements RinseDestination {
  readonly kind = 'FOLDER' as const;

  constructor(private readonly parent: string) {}

  async write(files: ReadonlyMap<string, Uint8Array>, manifest: RinseManifest): Promise<{ location: string; written: number }> {
    const name = manifest.set.name.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Rinsed set';
    const root = resolve(this.parent, name);
    await mkdir(root, { recursive: false });
    let written = 0;
    for (const [path, bytes] of [...files, [RINSE_MANIFEST_FILE, new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`)] as const]) {
      // Paths come from the manifest schema: relative, inside the folder. Checked again before writing.
      if (!rinsePathSchema.safeParse(path).success) throw new Error('A path outside the set');
      const target = resolve(root, path);
      if (!target.startsWith(`${root}${sep}`)) throw new Error('A path outside the set');
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: 'wx' });
      written += 1;
    }
    return { location: root, written };
  }
}
