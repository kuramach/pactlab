import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { AiQueue } from './ai-queue';
import { Bench } from './bench';
import type { CloudClientIds } from './cloud-signin';
import { BundledConverter, bundledTools, LocalToolConverter, TesseractOcr } from './converter';
import { PactlabApi, SessionStore } from './pactlab';
import { handle, type SidecarRequest } from './sidecar';

/** Baked in by scripts/build-sidecar.mjs: the Rinse app's public client ids with each drive. */
declare const __RINSE_CLOUD_CLIENTS__: CloudClientIds | undefined;

/** The sidecar process the shell starts (`externalBin` rinse-engine). Its data folder is the app's own. */
const dataDir =
  process.env['PACTLAB_RINSE_DATA'] ??
  join(
    homedir(),
    platform() === 'darwin' ? 'Library/Application Support/ai.pactlab.rinse' : '.pactlab-rinse',
  );

/** The bundled converters, from the app's resources (the shell passes their folder). Absent: fail closed. */
function converter(): BundledConverter {
  const resources = process.env['PACTLAB_RINSE_RESOURCES'];
  const tools = resources ? bundledTools(resources) : null;
  return new BundledConverter(
    tools && existsSync(tools.soffice) ? new LocalToolConverter(tools.soffice) : null,
    tools && existsSync(tools.tesseract) ? new TesseractOcr(tools.tesseract, tools.tessdata) : null,
  );
}

async function main(): Promise<void> {
  const queue = await AiQueue.open(join(dataDir, 'ai-queue.json'));
  const api = new PactlabApi(process.env['PACTLAB_ORIGIN'] ?? 'https://app.pactlab.ai');
  const sessions = new SessionStore(join(dataDir, 'session.json'));
  // Page images come from the shell's renderer; until it sends them, vision jobs wait in the queue.
  const pageImage = async () => new Uint8Array();
  const context = {
    api,
    sessions,
    queue,
    pageImage,
    device: `Pactlab Rinse on ${platform()}`,
    bench: new Bench({ api, loadSession: () => sessions.load(), queue, converter: converter(), pageImage, cloudClients: typeof __RINSE_CLOUD_CLIENTS__ === 'undefined' ? {} : __RINSE_CLOUD_CLIENTS__ }),
  };
  for await (const line of createInterface({ input: process.stdin })) {
    let request: SidecarRequest;
    try {
      request = JSON.parse(line) as SidecarRequest;
    } catch {
      process.stdout.write(`${JSON.stringify({ id: -1, ok: false, code: 'NOT_JSON' })}\n`);
      continue;
    }
    process.stdout.write(`${JSON.stringify(await handle(context, request))}\n`);
  }
}

// Bundled as CommonJS for the sidecar, so no top-level await.
void main();
