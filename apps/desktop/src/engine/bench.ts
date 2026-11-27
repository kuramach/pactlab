import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { COMPANY_TYPES, HAND_ENTRY_FORM_IDS, type CompanyType, type ExpectedInputId, type HandEntryFormId, type HandFieldProblem, type HandRow } from '@pactlab/domain';
import type { AiQueue } from './ai-queue';
import type { CloudSession, CloudProvider } from './cloud';
import { CLOUD_PROVIDERS, cloudDestination } from './cloud';
import { startCloudSignIn, type CloudClientIds } from './cloud-signin';
import type { Converter } from './converter';
import { FolderDestination, MAX_RINSE_FILE_BYTES, readFolder } from './folders';
import { HttpRinseAiClient, PactlabApiError, preparerUserId, signedIn, type CachedSession, type PactlabApi } from './pactlab';
import { RinseSet } from './rinse-set';

/**
 * The bench the window drives (T-178e): one document set at a time, held in the sidecar. Opening a set
 * needs the signed-in preparer (it is what makes the finished set trustworthy); after that, every
 * deterministic step works offline. The window never sees a file's bytes, the session token or a
 * drive's token: it sends commands and renders the set's view.
 */
export type BenchRequest =
  | { command: 'set.open'; folder: string; name: string; companyType: string; currency: string; bindingId: string | null }
  | { command: 'set.rinse'; online: boolean }
  | { command: 'set.view' }
  | { command: 'set.addFile'; path: string; input: string }
  | { command: 'set.exclude'; fileId: string }
  | { command: 'set.rerun'; fileId: string }
  | { command: 'set.noteGap'; input: string; kind: 'NOT_APPLICABLE' | 'NOTED'; note: string }
  | { command: 'set.handEntry'; form: string; rows: HandRow[]; entryId: string | null }
  | { command: 'set.write'; parent: string }
  | { command: 'set.upload'; provider: string }
  | { command: 'cloud.signIn'; provider: string }
  | { command: 'cloud.status' }
  | { command: 'cloud.signOut'; provider: string };

export interface BenchDeps {
  readonly api: PactlabApi;
  readonly loadSession: () => Promise<CachedSession | null>;
  readonly queue: AiQueue;
  readonly converter: Converter;
  readonly pageImage: (sha256: string, page: number) => Promise<Uint8Array>;
  readonly cloudClients: CloudClientIds;
  readonly fetcher?: (url: string, init: RequestInit) => Promise<Response>;
}

export const BENCH_COMMANDS = new Set<string>(['set.open', 'set.rinse', 'set.view', 'set.addFile', 'set.exclude', 'set.rerun', 'set.noteGap', 'set.handEntry', 'set.write', 'set.upload', 'cloud.signIn', 'cloud.status', 'cloud.signOut']);

const refuse = (code: string): never => {
  throw new PactlabApiError(400, code);
};
const isCompanyType = (value: string): value is CompanyType => (COMPANY_TYPES as readonly string[]).includes(value);
const isForm = (value: string): value is HandEntryFormId => (HAND_ENTRY_FORM_IDS as readonly string[]).includes(value);
const isProvider = (value: string): value is CloudProvider => (CLOUD_PROVIDERS as readonly string[]).includes(value);

export class Bench {
  private set: RinseSet | null = null;
  private name = '';
  private binding: { bindingId: string; pack: string } | null = null;
  private lastWritten: { location: string; written: number } | null = null;
  private readonly cloud = new Map<CloudProvider, CloudSession>();
  private readonly cloudPending = new Map<CloudProvider, string>();
  private readonly cloudFailed = new Map<CloudProvider, string>();

  constructor(private readonly deps: BenchDeps) {}

  private current(): RinseSet {
    return this.set ?? refuse('NO_SET');
  }

  private state(extra: { problems?: HandFieldProblem[] } = {}) {
    if (!this.set) return { open: false as const };
    return { open: true as const, name: this.name, view: this.set.view(), written: this.lastWritten, ...extra };
  }

  private cloudState() {
    return CLOUD_PROVIDERS.map((provider) => ({
      provider,
      registered: provider !== 'BOX' && Boolean(this.deps.cloudClients[provider]),
      signedIn: this.cloud.has(provider),
      pending: this.cloudPending.has(provider),
      failed: this.cloudFailed.get(provider) ?? null,
    }));
  }

  async run(request: BenchRequest): Promise<unknown> {
    switch (request.command) {
      case 'set.open':
        return this.open(request);
      case 'set.rinse': {
        const set = this.current();
        const session = await this.deps.loadSession();
        const ai = request.online && signedIn(session) && this.binding ? new HttpRinseAiClient(this.deps.api, session, this.binding) : undefined;
        await set.rinse({ online: request.online, ...(ai ? { ai } : {}) });
        return this.state();
      }
      case 'set.view':
        return this.state();
      case 'set.addFile': {
        const set = this.current();
        const info = await stat(request.path);
        if (!info.isFile() || info.size > MAX_RINSE_FILE_BYTES) refuse('FILE_TOO_LARGE');
        // The seller added it for this expected document: their classification wins over the AI's.
        for (const id of set.add(basename(request.path), new Uint8Array(await readFile(request.path)))) set.classify(id, request.input);
        return this.state();
      }
      case 'set.exclude':
        this.current().exclude(request.fileId);
        return this.state();
      case 'set.rerun':
        await this.current().rerun(request.fileId);
        return this.state();
      case 'set.noteGap':
        this.current().noteGap(request.input as ExpectedInputId, request.kind, request.note);
        return this.state();
      case 'set.handEntry': {
        if (!isForm(request.form)) return refuse('UNKNOWN_FORM');
        const result = await this.current().enterByHand(request.form, request.rows, request.entryId ?? undefined);
        return this.state({ problems: result.problems });
      }
      case 'set.write': {
        const set = this.current();
        const manifest = set.manifest();
        this.lastWritten = await new FolderDestination(request.parent).write(set.output(manifest), manifest);
        return this.state();
      }
      case 'set.upload': {
        if (!isProvider(request.provider)) return refuse('UNKNOWN_PROVIDER');
        const session = this.cloud.get(request.provider) ?? refuse('CLOUD_SIGNED_OUT');
        const set = this.current();
        const manifest = set.manifest();
        this.lastWritten = await cloudDestination(session).write(set.output(manifest), manifest);
        return this.state();
      }
      case 'cloud.signIn': {
        if (!isProvider(request.provider)) return refuse('UNKNOWN_PROVIDER');
        const provider = request.provider;
        const started = await startCloudSignIn(provider, this.deps.cloudClients, this.deps.fetcher);
        this.cloudPending.set(provider, started.url);
        this.cloudFailed.delete(provider);
        started.session.then(
          (session) => this.cloud.set(provider, session),
          // handled: `cloud.status` reports the failure and the window offers to sign in again.
          (error: Error) => this.cloudFailed.set(provider, error.message),
        ).finally(() => this.cloudPending.delete(provider));
        return { url: started.url, cloud: this.cloudState() };
      }
      case 'cloud.status':
        return { cloud: this.cloudState() };
      case 'cloud.signOut':
        if (isProvider(request.provider)) this.cloud.delete(request.provider);
        return { cloud: this.cloudState() };
    }
  }

  private async open(request: Extract<BenchRequest, { command: 'set.open' }>) {
    const session = await this.deps.loadSession();
    if (!session || !signedIn(session)) return refuse('SIGNED_OUT');
    const userId = preparerUserId(session.token);
    if (!userId || !session.name || !session.organization) return refuse('PREPARER_UNKNOWN');
    if (!isCompanyType(request.companyType)) return refuse('UNKNOWN_PACK');
    if (!/^[A-Z]{3}$/.test(request.currency)) return refuse('UNKNOWN_CURRENCY');
    const name = request.name.trim();
    if (name.length < 1 || name.length > 200) return refuse('NAME_REQUIRED');
    const binding = request.bindingId ? (session.bindings.find((entry) => entry.bindingId === request.bindingId) ?? refuse('NOT_BOUND')) : null;
    const set = new RinseSet({
      name,
      companyType: request.companyType,
      currency: request.currency,
      preparer: { userId, name: session.name, organization: session.organization },
      intendedPact: binding ? { organizationId: binding.organizationId, dealId: binding.dealId, bindingId: binding.bindingId } : null,
      converter: this.deps.converter,
      queue: this.deps.queue,
    });
    for (const file of await readFolder(request.folder)) set.add(file.path, file.bytes);
    this.set = set;
    this.name = name;
    this.binding = binding ? { bindingId: binding.bindingId, pack: request.companyType } : null;
    this.lastWritten = null;
    return this.state();
  }
}
