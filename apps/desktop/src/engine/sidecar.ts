import type { PrepInvitePreview, PreparerBindingView } from '@pactlab/contracts';
import type { AiQueue } from './ai-queue';
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
  | { id: number; command: 'session.verify'; token: string; email: string; code: string }
  | { id: number; command: 'session.signOut' }
  | { id: number; command: 'ai.drain'; bindingId: string; pack: string; online: boolean };

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
}

export interface SessionStatus {
  signedIn: boolean;
  email: string | null;
  expiresAt: string | null;
  bindings: readonly PreparerBindingView[];
  /** AI steps and uploads waiting for sign-in or the network. */
  waiting: number;
}

export async function handle(context: SidecarContext, request: SidecarRequest): Promise<SidecarReply> {
  try {
    return { id: request.id, ok: true, result: await run(context, request) };
  } catch (error) {
    return { id: request.id, ok: false, code: error instanceof PactlabApiError ? error.code : 'FAILED' };
  }
}

async function status(context: SidecarContext): Promise<SessionStatus> {
  const session = await context.sessions.load();
  const live = signedIn(session);
  return { signedIn: live, email: live ? session.email : null, expiresAt: live ? session.expiresAt : null, bindings: live ? session.bindings : [], waiting: context.queue.pending().length };
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
    case 'session.verify':
      await context.sessions.save(await context.api.verifySignIn({ token: request.token, email: request.email, code: request.code, device: context.device }));
      return status(context);
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
      throw new PactlabApiError(400, 'UNKNOWN_COMMAND');
  }
}
