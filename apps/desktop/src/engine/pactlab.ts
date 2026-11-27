import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { PrepInvitePreview, PreparerBindingView, PreparerSession, RinseClassifyResult, RinseVisionResult } from '@pactlab/contracts';
import type { AiJob, Classification, RinseAiClient } from './ai-queue';

/**
 * The desktop's Pactlab sign-in and AI rinse jobs (T-178b, ADR 0059). The preparer signs in from a prep
 * invite with an emailed code; the session is cached on the machine so the app opens offline, and AI
 * steps and uploads wait in the queue while signed out or offline. Every request goes to the one
 * configured Pactlab origin over HTTPS; redirects are not followed; tokens are never logged.
 */
export class PactlabApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Pactlab answered ${status} ${code}`);
    this.name = 'PactlabApiError';
  }
}

/** A session the app keeps: the token, its expiry and the pacts the preparer is bound to. */
export interface CachedSession {
  readonly origin: string;
  readonly email: string;
  readonly token: string;
  readonly expiresAt: string;
  readonly bindings: readonly PreparerBindingView[];
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export class PactlabApi {
  private readonly origin: string;

  constructor(
    origin: string,
    private readonly fetcher: Fetch = (url, init) => fetch(url, init),
  ) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error('Pactlab is reached over HTTPS only');
    this.origin = url.origin;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, token?: string): Promise<T> {
    const response = await this.fetcher(`${this.origin}${path}`, {
      method,
      redirect: 'manual',
      headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      let code = 'ERROR';
      try {
        code = ((await response.json()) as { code?: string }).code ?? code;
      } catch {
        // A body that is not JSON: the status says enough.
      }
      throw new PactlabApiError(response.status, code);
    }
    return (await response.json()) as T;
  }

  previewInvite(token: string): Promise<PrepInvitePreview> {
    return this.call('POST', '/v1/rinse/invites/preview', { token });
  }

  async startSignIn(input: { token: string; email: string; displayName: string }): Promise<void> {
    await this.call('POST', '/v1/rinse/sign-in/start', input);
  }

  async verifySignIn(input: { token: string; email: string; code: string; device: string }): Promise<CachedSession> {
    const session = await this.call<PreparerSession>('POST', '/v1/rinse/sign-in/verify', { ...input, trust: '30d' });
    return { origin: this.origin, email: input.email.trim().toLowerCase(), token: session.token, expiresAt: session.expiresAt, bindings: session.bindings };
  }

  async bindings(token: string): Promise<PreparerBindingView[]> {
    return (await this.call<{ bindings: PreparerBindingView[] }>('GET', '/v1/rinse/me', undefined, token)).bindings;
  }

  classify(token: string, body: { bindingId: string; pack: string; fileName: string; folder: string | null; pageTexts: readonly string[] }): Promise<RinseClassifyResult> {
    return this.call('POST', '/v1/rinse/ai/classify', body, token);
  }

  vision(token: string, body: { bindingId: string; fileName: string; page: number; image: { format: 'png' | 'jpeg'; base64: string } }): Promise<RinseVisionResult> {
    return this.call('POST', '/v1/rinse/ai/vision', body, token);
  }
}

/** The cached session, in the app's data folder, owner-only (the shell moves it to the OS keychain). */
export class SessionStore {
  constructor(private readonly path: string) {}

  async load(): Promise<CachedSession | null> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as CachedSession;
    } catch {
      return null;
    }
  }

  async save(session: CachedSession): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify(session), { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, this.path);
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }
}

/** Signed in while the cached session has not expired; offline, the app still opens on it. */
export const signedIn = (session: CachedSession | null, now = new Date()): session is CachedSession => session !== null && new Date(session.expiresAt).getTime() > now.getTime();

const PNG = [0x89, 0x50, 0x4e, 0x47];
const JPEG = [0xff, 0xd8, 0xff];
const startsWith = (bytes: Uint8Array, magic: readonly number[]) => magic.every((byte, index) => bytes[index] === byte);

/**
 * The AI gateway as the desktop reaches it: classification and the vision lane, as metered jobs under
 * the preparer's session and binding, counted against the bound pact. A failed call (offline, signed
 * out, rate-limited, the gateway down) rejects, and the job stays queued.
 */
export class HttpRinseAiClient implements RinseAiClient {
  constructor(
    private readonly api: PactlabApi,
    private readonly session: CachedSession,
    private readonly binding: { bindingId: string; pack: string },
  ) {}

  async classify(job: Extract<AiJob, { kind: 'CLASSIFY' }>): Promise<Classification> {
    if (!signedIn(this.session)) throw new PactlabApiError(401, 'SIGNED_OUT');
    const slash = job.fileName.lastIndexOf('/');
    const result = await this.api.classify(this.session.token, {
      bindingId: this.binding.bindingId,
      pack: this.binding.pack,
      fileName: job.fileName.slice(slash + 1),
      folder: slash > 0 ? job.fileName.slice(0, slash) : null,
      pageTexts: job.pageTexts.slice(0, 3).map((text) => text.slice(0, 12_000)),
    });
    return { category: result.category, confidence: result.confidence, promptVersion: result.promptVersion, aiExcluded: result.aiExcluded };
  }

  /** Each page's image comes from the shell's renderer (PNG or JPEG); anything else waits in the queue. */
  async readPages(job: Extract<AiJob, { kind: 'VISION' }>, image: (page: number) => Promise<Uint8Array>): Promise<string[]> {
    if (!signedIn(this.session)) throw new PactlabApiError(401, 'SIGNED_OUT');
    const pages: string[] = [];
    for (let page = 1; page <= job.pages; page += 1) {
      const bytes = await image(page);
      const format = startsWith(bytes, PNG) ? 'png' : startsWith(bytes, JPEG) ? 'jpeg' : null;
      if (!format) throw new PactlabApiError(0, 'PAGE_IMAGE_UNAVAILABLE');
      const result = await this.api.vision(this.session.token, { bindingId: this.binding.bindingId, fileName: job.fileName, page, image: { format, base64: Buffer.from(bytes).toString('base64') } });
      pages.push(result.text ?? '');
    }
    return pages;
  }
}
