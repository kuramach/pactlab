import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * No silent failures (T-125). Every `.catch(` in the API and the worker says, just above it, what the
 * person sees when it fails:
 *   // handled: <where the failure shows, or that it is rethrown as an error the person sees>
 *   // silent-ok: <why nobody needs to know: e.g. cleanup nobody waits for, or a reply that must not differ>
 * A catch that only logs, with neither, is how a fetch failed on live with nothing on screen.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const sources = ['apps/api/src', 'apps/worker/src'].map((dir) => join(root, dir));

function files(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' || name === 'testing' ? [] : files(path);
    return /\.ts$/.test(name) && !/\.test\.ts$|testing\.ts$/.test(name) ? [path] : [];
  });
}

describe('no silent failures (T-125)', () => {
  it('every .catch in the API and worker says what the person sees', () => {
    const unexplained: string[] = [];
    for (const file of sources.flatMap(files)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (!line.includes('.catch(')) return;
        const context = lines.slice(Math.max(0, index - 3), index + 1).join('\n');
        if (!/\/\/ (handled|silent-ok): \S/.test(context)) unexplained.push(`${relative(root, file)}:${index + 1}  ${line.trim().slice(0, 100)}`);
      });
    }
    // The scan itself must have found the code it guards.
    expect(sources.flatMap(files).length).toBeGreaterThan(100);
    expect(unexplained, 'Add `// handled: …` or `// silent-ok: …` just above each (see apps/api/src/no-silent-failures.test.ts).').toEqual([]);
  });
});
