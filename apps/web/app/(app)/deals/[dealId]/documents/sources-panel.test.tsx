import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { folderFromInput, GOOGLE_LIMIT, readsWhat, readsWith, SourcesPanel, type SourcesView } from './sources-panel';

vi.mock('./actions', () => ({ addChosenFiles: vi.fn(), connectSource: vi.fn(), disconnectSource: vi.fn(), pickerFor: vi.fn(), signInForFolder: vi.fn(), syncSource: vi.fn() }));
vi.mock('./google-picker', () => ({ chooseDriveFiles: vi.fn() }));
vi.mock('./folder-chooser', () => ({ FolderChooser: () => null }));
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

  it('one button per service, plain words; Google Drive’s limit is said where it is chosen; nothing to paste', () => {
    const html = renderToStaticMarkup(
      <SourcesPanel
        dealId="d"
        aiOn
        sources={{
          items: [],
          fixtureRooms: [],
          signedIn: [],
          providers: [
            { provider: 'google-drive', label: 'Google Drive', organizationSignedIn: false },
            { provider: 'onedrive', label: 'OneDrive / SharePoint', organizationSignedIn: false },
          ],
          seller: false,
        }}
      />,
    );
    expect(html).toContain('Add documents from');
    expect(html).toContain('Connect Google Drive');
    expect(html).toContain('With Google Drive, you pick the files to share.');
    expect(html).toContain('won’t appear here until you add them too');
    expect(html).not.toContain('aria-label="Folder"');
    expect(html).not.toMatch(/token|drive-id|scope|permission/i);
    expect(GOOGLE_LIMIT).toContain('Changes to files you picked do come through.');
  });

  it('OneDrive with the organization’s sign-in: one Connect, and a different account if wanted', () => {
    const html = renderToStaticMarkup(
      <SourcesPanel dealId="d" aiOn sources={{ items: [], fixtureRooms: [], signedIn: ['onedrive'], providers: [{ provider: 'onedrive', label: 'OneDrive / SharePoint', organizationSignedIn: true }], seller: false }} />,
    );
    expect(html).toContain('Connect OneDrive / SharePoint');
    expect(html).toContain('Use a different Microsoft account');
    expect(html).toContain('With OneDrive, you pick a folder next.');
  });

  it('each source says what it shares, in plain words, with the next step', () => {
    expect(readsWhat(source({ provider: 'google-drive', filesChosen: 12 }))).toBe('12 files shared · new files in the folder need Add files');
    expect(readsWhat(source({ provider: 'onedrive', providerLabel: 'OneDrive / SharePoint' }))).toBe('Whole folder · new files come in automatically');
    expect(readsWhat(source({ provider: 'onedrive', needsFolder: true }))).toBe('No folder chosen yet');
    const html = renderToStaticMarkup(
      <SourcesPanel
        dealId="d"
        aiOn
        sources={{
          items: [
            source({ kind: 'PERSON', signedInAs: 'kumar@example.com', filesChosen: 3, canChooseFiles: true }),
            source({ id: 's2', provider: 'onedrive', providerLabel: 'OneDrive / SharePoint', needsFolder: true, canChooseFolder: true }),
          ],
          fixtureRooms: [],
          providers: [],
          seller: false,
        }}
      />,
    );
    expect(html).toContain('3 files shared');
    expect(html).toContain('Add files');
    expect(html).toContain('Choose folder');
  });

  it('says so when no drive can be connected here', () => {
    expect(renderToStaticMarkup(<SourcesPanel dealId="d" aiOn={false} sources={{ items: [], fixtureRooms: [], providers: [], seller: true }} />)).toContain('You can upload files instead');
  });
});
