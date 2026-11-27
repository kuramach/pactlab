import type { SidecarTransport } from './sidecar-client';

/**
 * The few Tauri APIs the window uses, through the globals Tauri injects (`app.withGlobalTauri`), so the
 * window needs no Tauri packages of its own. Only what the capability file allows works: starting the
 * engine sidecar, the folder and file pickers, opening an https address in the seller's browser, the
 * app's resource folder, and prep-invite deep links.
 */
interface ShellChild {
  write(data: string): Promise<void>;
}
interface ShellCommand {
  stdout: { on(event: 'data', listener: (line: string) => void): void };
  on(event: 'close', listener: () => void): void;
  spawn(): Promise<ShellChild>;
}
interface TauriGlobals {
  shell: {
    Command: { sidecar(program: string, args: string[], options?: { env?: Record<string, string> }): ShellCommand };
    open(url: string): Promise<void>;
  };
  dialog: { open(options: { directory?: boolean; multiple?: boolean; title?: string }): Promise<string | string[] | null> };
  path: { resolveResource(path: string): Promise<string>; resourceDir(): Promise<string> };
  deepLink?: { getCurrent(): Promise<string[] | null>; onOpenUrl(listener: (urls: string[]) => void): Promise<unknown> };
}

declare global {
  interface Window {
    __TAURI__?: TauriGlobals;
  }
}

const tauri = (): TauriGlobals => {
  const globals = window.__TAURI__;
  if (!globals) throw new Error('Pactlab Rinse runs inside its desktop shell');
  return globals;
};

/** Start the engine: the bundled Node runs the bundled engine, told where the converters are. */
export async function startEngine(onClose: () => void): Promise<SidecarTransport> {
  const { shell, path } = tauri();
  const script = await path.resolveResource('rinse-engine.cjs');
  const command = shell.Command.sidecar('binaries/rinse-engine', [script], { env: { PACTLAB_RINSE_RESOURCES: await path.resourceDir() } });
  const listeners: ((line: string) => void)[] = [];
  command.stdout.on('data', (line) => listeners.forEach((listener) => listener(line)));
  command.on('close', onClose);
  const child = await command.spawn();
  return { write: (line) => child.write(line), onLine: (listener) => void listeners.push(listener) };
}

export async function chooseFolder(title: string): Promise<string | null> {
  const picked = await tauri().dialog.open({ directory: true, multiple: false, title });
  return typeof picked === 'string' ? picked : null;
}

export async function chooseFile(title: string): Promise<string | null> {
  const picked = await tauri().dialog.open({ directory: false, multiple: false, title });
  return typeof picked === 'string' ? picked : null;
}

/** Opens a provider's sign-in page in the seller's own browser (https only, by the capability's scope). */
export const openInBrowser = (url: string) => tauri().shell.open(url);

/** The token in a prep-invite deep link, `pactlab-rinse://invite?token=…`, or a pasted https invite link. */
export function inviteToken(link: string): string | null {
  try {
    const url = new URL(link.trim());
    const token = url.searchParams.get('invite') ?? url.searchParams.get('token');
    return token && /^[A-Za-z0-9_-]{20,100}$/.test(token) ? token : null;
  } catch {
    return /^[A-Za-z0-9_-]{20,100}$/.test(link.trim()) ? link.trim() : null;
  }
}

export async function onInvite(listener: (token: string) => void): Promise<void> {
  const deepLink = window.__TAURI__?.deepLink;
  if (!deepLink) return;
  const take = (urls: string[] | null) => {
    for (const url of urls ?? []) {
      const token = inviteToken(url);
      if (token) listener(token);
    }
  };
  take(await deepLink.getCurrent());
  await deepLink.onOpenUrl(take);
}
