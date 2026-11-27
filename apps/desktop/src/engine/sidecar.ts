import type { PrepInvitePreview, PreparerBindingView } from '@pactlab/contracts';
import type { AiQueue } from './ai-queue';
import { CloudDestinationError } from './cloud';
import { ConversionError } from './converter';
import { BENCH_COMMANDS, type Bench, type BenchRequest } from './bench';
import type { PactlabApi, SessionStore} from './pactlab';
import { HttpRinseAiClient, PactlabApiError, signedIn } from './pactlab';

/**
 * The engine as the Tauri shell runs it (T-178b): a Node sidecar answering one JSON request per line on
 * stdin with one JSON reply per line on stdout. The window never holds the session token; it asks the
 * sidecar. Only these commands exist; anything else is refused.
 */
export type SidecarRequest =
  | { id: number; command: 'session.status' }
  | { id: number; command: 'invite.preview'; token: string }
  | { id: number; command: 'session.start'; token: string; email: string; displayName: string }
  | { id: number; command: 'session.verify'; token: string; email: string; code: string; name: string; organization: string }
  | { id: number; command: 'session.signOut' }
  | { id: number; command: 'ai.drain'; bindingId: string; pack: string; online: boolean }
  // The bench (T-178e): opening, rinsing and finishing one set.
  | ({ id: number } & BenchRequest);

export type SidecarReply =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; code: string };

export interface SidecarContext {
  readonly api: PactlabApi;
  readonly sessions: SessionStore;
  readonly queue: AiQueue;
  /** A page image for the vision lane, from the shell's renderer; the file's own bytes for an image. */
  readonly pageImage: (sha256: string, page: number) => Promise<Uint8Array>;
  readonly device: string;
  readonly bench?: Bench;
}

export interface SessionStatus {
  signedIn: boolean;
  email: string | null;
  name: string | null;
  organization: string | null;
  expiresAt: string | null;
  bindings: readonly PreparerBindingView[];
  /** AI steps and uploads waiting for sign-in or the network. */
  waiting: number;
}

export async function handle(context: SidecarContext, request: SidecarRequest): Promise<SidecarReply> {
  try {
    return { id: request.id, ok: true, result: await run(context, request) };
  } catch (error) {
    return { id: request.id, ok: false, code: errorCode(error) };
  }
}

/** A stable code the window turns into words; never the error's own text, which may carry a path. */
function errorCode(error: unknown): string {
  if (error instanceof PactlabApiError) return error.code;
  if (error instanceof CloudDestinationError) return `CLOUD_${error.reason}`;
  if (error instanceof ConversionError) return `CONVERSION_${error.reason}`;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'EEXIST') return 'EXISTS';
  if (code === 'ENOENT') return 'NOT_FOUND';
  if (code === 'EACCES' || code === 'EPERM') return 'NO_ACCESS';
  if (error instanceof Error && error.message === 'The set is not ready') return 'NOT_READY';
  if (error instanceof Error && error.message === 'A note is required') return 'NOTE_REQUIRED';
  return 'FAILED';
}

async function status(context: SidecarContext): Promise<SessionStatus> {
  const session = await context.sessions.load();
  const live = signedIn(session);
  return { signedIn: live, email: live ? session.email : null, name: live ? (session.name ?? null) : null, organization: live ? (session.organization ?? null) : null, expiresAt: live ? session.expiresAt : null, bindings: live ? session.bindings : [], waiting: context.queue.pending().length };
}

async function run(context: SidecarContext, request: SidecarRequest): Promise<unknown> {
  switch (request.command) {
    case 'session.status':
      return status(context);
    case 'invite.preview':
      return context.api.previewInvite(request.token) satisfies Promise<PrepInvitePreview>;
    case 'session.start':
      await context.api.startSignIn({ token: request.token, email: request.email, displayName: request.displayName });
      return { sent: true };
    case 'session.verify': {
      const name = request.name.trim();
      const organization = request.organization.trim();
      if (!name || !organization || name.length > 200 || organization.length > 200) throw new PactlabApiError(400, 'PREPARER_UNKNOWN');
      const session = await context.api.verifySignIn({ token: request.token, email: request.email, code: request.code, device: context.device });
      await context.sessions.save({ ...session, name, organization });
      return status(context);
    }
    case 'session.signOut':
      await context.sessions.clear();
      return status(context);
    case 'ai.drain': {
      const session = await context.sessions.load();
      // Signed out or offline: nothing runs, nothing is lost.
      if (!request.online || !signedIn(session) || !session.bindings.some((binding) => binding.bindingId === request.bindingId)) return { ran: 0, waiting: context.queue.pending().length };
      return context.queue.drain(new HttpRinseAiClient(context.api, session, { bindingId: request.bindingId, pack: request.pack }), context.pageImage);
    }
    default:
      if (context.bench && BENCH_COMMANDS.has(request.command)) return context.bench.run(request);
      throw new PactlabApiError(400, 'UNKNOWN_COMMAND');
  }
}
