// T-178b: bundle the Rinse window (React) into dist/, which the shell serves (`build.frontendDist`).
// The window's entry, src/ui/main.tsx, wires the Rinse screens to the engine sidecar; until it exists
// this script fails, so no installer is ever built with an empty window (docs/runbooks/rinse.md).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(root, 'src/ui/main.tsx');
if (!existsSync(entry)) {
  process.stderr.write('::error title=Rinse window::src/ui/main.tsx (the window wired to the engine sidecar) is not built yet; see docs/runbooks/rinse.md\n');
  process.exit(1);
}
mkdirSync(join(root, 'dist'), { recursive: true });
await build({ entryPoints: [entry], outfile: join(root, 'dist/main.js'), bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', minify: true, legalComments: 'external' });
writeFileSync(join(root, 'dist/index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Pactlab Rinse</title></head><body><div id="root"></div><script type="module" src="./main.js"></script></body></html>\n');
