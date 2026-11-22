import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { folderFromInput, readsWith, SourcesPanel, type SourcesView } from './sources-panel';

vi.mock('./actions', () => ({ connectSource: vi.fn(), disconnectSource: vi.fn(), signInForFolder: vi.fn(), syncSource: vi.fn() }));
vi.mock('./sorting', () => ({ sortDocument: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const source = (overrides: Partial<SourcesView['items'][number]> = {}): SourcesView['items'][number] => ({
  id: 's1',
  provider: 'google-drive',
  providerLabel: 'Google Drive',
  mode: 'LIVE',
  displayName: 'Seller data room',
  folder: 'f',
  status: 'ACTIVE',
  lastSyncedAt: null,
  lastSyncSummary: null,
  ...overrides,
});

describe('connecting a drive folder from the pact', () => {
  it('takes a pasted Google Drive folder link as its id', () => {
    expect(folderFromInput('google-drive', 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing')).toBe('1AbCdEfGhIjKlMnOp');
    expect(folderFromInput('google-drive', 'https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp')).toBe('1AbCdEfGhIjKlMnOp');
    expect(folderFromInput('onedrive', 'b!drive/01ITEM')).toBe('b!drive/01ITEM');
  });

  it('says how each source reads, never a token', () => {
    expect(readsWith(source({ kind: 'PERSON', signedInAs: 'seller@example.com' }))).toBe('Signed in as seller@example.com');
    expect(readsWith(source({ kind: 'ORGANIZATION' }))).toBe('Organization sign-in');
    expect(readsWith(source({ kind: 'TOKEN' }))).toBe('Pasted access token');
  });

  it('a seller signs in with their own account; told the folder is shared; no synthetic rooms', () => {
    const html = renderToStaticMarkup(
      <SourcesPanel
        dealId="d"
        aiOn
        sources={{ items: [source({ kind: 'PERSON', signedInAs: 'seller@example.com', shared: true, canDisconnect: true })], fixtureRooms: [], providers: [{ provider: 'google-drive', label: 'Google Drive', organizationSignedIn: false }], seller: true }}
      />,
    );
    expect(html).toContain('Signed in as seller@example.com · shared with the deal team');
    expect(html).toContain('Disconnect');
  });

  it('the deal team may sign in themselves or use the organization’s sign-in', () => {
    const html = renderToStaticMarkup(
      <SourcesPanel dealId="d" aiOn sources={{ items: [], fixtureRooms: [], signedIn: ['google-drive'], providers: [{ provider: 'google-drive', label: 'Google Drive', organizationSignedIn: true }], seller: false }} />,
    );
    expect(html).toContain('Sign in with Google');
    expect(html).toContain('Use the organization’s Google Drive');
    expect(html).not.toContain('access token');
  });

  it('says so when no drive can be connected here', () => {
    expect(renderToStaticMarkup(<SourcesPanel dealId="d" aiOn={false} sources={{ items: [], fixtureRooms: [], providers: [], seller: true }} />)).toContain('Upload the files instead');
  });
});
