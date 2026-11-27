// T-178b, T-178e: bundle the Rinse window (React) into dist/, which the shell serves (`build.frontendDist`).
// The window's entry, src/ui/main.tsx, mounts the Rinse screens on the engine sidecar; its styles are
// Tailwind with the Pactlab tokens (src/ui/styles.css). Fonts fall back to the system's when Manrope is absent.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwind from '@tailwindcss/postcss';
import { build } from 'esbuild';
import postcss from 'postcss';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });
await build({ entryPoints: [join(root, 'src/ui/main.tsx')], outfile: join(dist, 'main.js'), bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', minify: true, legalComments: 'external', define: { 'process.env.NODE_ENV': '"production"' } });
const source = join(root, 'src/ui/styles.css');
const css = await postcss([tailwind()]).process(readFileSync(source, 'utf8'), { from: source, to: join(dist, 'styles.css') });
writeFileSync(join(dist, 'styles.css'), css.css);
writeFileSync(
  join(dist, 'index.html'),
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pactlab Rinse</title><link rel="stylesheet" href="./styles.css"></head><body><div id="root"></div><script type="module" src="./main.js"></script></body></html>\n',
);
process.stdout.write('window built into dist/\n');
