import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { AiQueue } from './ai-queue';
import { PactlabApi, SessionStore } from './pactlab';
import { handle, type SidecarRequest } from './sidecar';

/** The sidecar process the shell starts (`externalBin` rinse-engine). Its data folder is the app's own. */
const dataDir =
  process.env['PACTLAB_RINSE_DATA'] ??
  join(
    homedir(),
    platform() === 'darwin' ? 'Library/Application Support/ai.pactlab.rinse' : '.pactlab-rinse',
  );

async function main(): Promise<void> {
  const queue = await AiQueue.open(join(dataDir, 'ai-queue.json'));
  const context = {
    api: new PactlabApi(process.env['PACTLAB_ORIGIN'] ?? 'https://app.pactlab.ai'),
    sessions: new SessionStore(join(dataDir, 'session.json')),
    queue,
    // Page images come from the shell's renderer; until it sends them, vision jobs wait in the queue.
    pageImage: async () => new Uint8Array(),
    device: `Pactlab Rinse on ${platform()}`,
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
