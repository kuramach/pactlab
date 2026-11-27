// T-178b: build the engine sidecar the shell runs (`bundle.externalBin` binaries/rinse-engine).
// The engine is bundled into one CommonJS file with esbuild; the sidecar binary is this runner's Node,
// named with the target triple as Tauri requires, and starts that file (bundled as a resource).
// Usage: node scripts/build-sidecar.mjs <target-triple>
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [target] = process.argv.slice(2);
if (!target) throw new Error('Name the Rust target triple');
await build({
  entryPoints: [join(root, 'src/engine/sidecar-main.ts')],
  outfile: join(root, 'src-tauri/resources/rinse-engine.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  // pdf.js's optional canvas is never loaded by the engine.
  external: ['@napi-rs/canvas', 'canvas'],
  legalComments: 'external',
});
const binaries = join(root, 'src-tauri/binaries');
mkdirSync(binaries, { recursive: true });
copyFileSync(process.execPath, join(binaries, `rinse-engine-${target}${target.includes('windows') ? '.exe' : ''}`));
process.stdout.write(`sidecar built for ${target}\n`);
