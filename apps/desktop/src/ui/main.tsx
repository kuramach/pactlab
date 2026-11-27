import { createRoot } from 'react-dom/client';
import { App } from './app';
import { SidecarClient } from './sidecar-client';
import { chooseFile, chooseFolder, onInvite, openInBrowser, startEngine } from './tauri';

/** The window's entry (T-178e): start the engine sidecar, then mount the Rinse screens on it. */
async function boot(): Promise<void> {
  const root = createRoot(document.getElementById('root') as HTMLElement);
  const transport = await startEngine(() => root.render(<p className="p-10 font-[Manrope] text-navy">The Rinse engine stopped. Close and reopen Pactlab Rinse; nothing you saved is lost.</p>));
  root.render(<App client={new SidecarClient(transport)} platform={{ chooseFolder, chooseFile, openInBrowser, onInvite, online: () => navigator.onLine }} />);
}

void boot();
