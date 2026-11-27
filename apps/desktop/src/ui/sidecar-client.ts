/**
 * The window's side of the engine sidecar (T-178e): one JSON request per line on the sidecar's stdin,
 * one JSON reply per line on its stdout, matched by id. The window holds no token and no file bytes; it
 * sends commands and renders what comes back. The transport is the Tauri shell plugin in the app, and a
 * stand-in in tests.
 */
export interface SidecarTransport {
  write(line: string): Promise<void>;
  onLine(listener: (line: string) => void): void;
}

export class SidecarFailure extends Error {
  constructor(readonly code: string) {
    super(`The engine answered ${code}`);
    this.name = 'SidecarFailure';
  }
}

type Reply = { id: number; ok: true; result: unknown } | { id: number; ok: false; code: string };

export class SidecarClient {
  private next = 1;
  private buffer = '';
  private readonly waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  constructor(private readonly transport: SidecarTransport) {
    transport.onLine((chunk) => this.receive(chunk));
  }

  /**
   * Replies arrive as whole lines (the shell plugin strips the newline) or in pieces. Complete lines are
   * read; a trailing piece is read too once it is whole JSON, and kept until then.
   */
  private receive(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    if (this.parse(this.buffer)) this.buffer = '';
    for (const line of lines) this.parse(line);
  }

  private parse(line: string): boolean {
    if (!line.trim()) return false;
    let reply: Reply;
    try {
      reply = JSON.parse(line) as Reply;
    } catch {
      return false;
    }
    const pending = this.waiting.get(reply.id);
    if (pending) {
      this.waiting.delete(reply.id);
      if (reply.ok) pending.resolve(reply.result);
      else pending.reject(new SidecarFailure(reply.code));
    }
    return true;
  }

  ask<T>(command: string, fields: Record<string, unknown> = {}): Promise<T> {
    const id = this.next;
    this.next += 1;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.transport.write(`${JSON.stringify({ ...fields, id, command })}\n`).catch((error: unknown) => {
        this.waiting.delete(id);
        reject(error instanceof Error ? error : new SidecarFailure('NOT_RUNNING'));
      });
    });
  }
}

/** What the window says for each code the engine can answer. Never the engine's own error text. */
const MESSAGES: Readonly<Record<string, string>> = {
  SIGNED_OUT: 'Sign in to Pactlab first: the set carries your name as its preparer.',
  PREPARER_UNKNOWN: 'Sign in again and give your name and company: they are stamped on the set.',
  NOT_BOUND: 'That pact is no longer linked to your account. Ask the deal team for a new invite.',
  NO_SET: 'Open a folder first.',
  NOT_READY: 'The set is not clean yet: fix every error and close or note every expected document.',
  EXISTS: 'A folder with this set’s name is already there. Choose another place; nothing was overwritten.',
  NOT_FOUND: 'That file or folder is no longer there.',
  NO_ACCESS: 'Pactlab Rinse may not read or write there. Choose another folder.',
  NOTE_REQUIRED: 'Write a short note (at least three characters).',
  FILE_TOO_LARGE: 'That file is over 200 MB, the largest Rinse reads.',
  UNKNOWN_PACK: 'Choose what kind of company this is.',
  NAME_REQUIRED: 'Give the set a name.',
  CLOUD_REFUSED: 'That drive refused, or is not registered for Pactlab Rinse yet. Write to a folder instead.',
  CLOUD_SIGNED_OUT: 'Sign in to that drive first.',
  CLOUD_EXISTS: 'A folder with this set’s name is already on that drive. Nothing was overwritten.',
  CLOUD_TOO_LARGE: 'A file is too large for that drive’s upload.',
  CLOUD_UNAVAILABLE: 'That drive did not answer. Try again, or write to a folder.',
  CLOUD_WRONG_HOST: 'The upload was stopped: it tried to leave for an address that is not the drive’s.',
  CONVERSION_TOOL_MISSING: 'The converter for this file is not in this installation. Leave the file out, or replace it with a PDF.',
  CONVERSION_FAILED: 'The conversion did not complete. Re-run it, or replace the file.',
  PREP_INVITE_UNAVAILABLE: 'That invite link is not valid any more. Ask the deal team for a new one.',
  RINSE_AI_RATE_LIMITED: 'Pactlab is pacing AI steps for your account. They stay queued and run shortly.',
  NOT_RUNNING: 'The Rinse engine stopped. Close and reopen Pactlab Rinse.',
};

export function messageFor(error: unknown): string {
  const code = error instanceof SidecarFailure ? error.code : 'FAILED';
  return MESSAGES[code] ?? 'That did not work. Nothing was lost; try again.';
}
