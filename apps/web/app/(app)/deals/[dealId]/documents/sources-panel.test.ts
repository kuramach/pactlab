import { describe, expect, it } from 'vitest';
import { folderFromInput } from './sources-panel';

describe('adding a drive folder (T-147)', () => {
  it('takes a pasted Google Drive folder link as its id', () => {
    expect(folderFromInput('google-drive', 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing')).toBe('1AbCdEfGhIjKlMnOp');
    expect(folderFromInput('google-drive', 'https://drive.google.com/drive/u/0/folders/1AbCdEfGhIjKlMnOp')).toBe('1AbCdEfGhIjKlMnOp');
    expect(folderFromInput('google-drive', 'https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp')).toBe('1AbCdEfGhIjKlMnOp');
    expect(folderFromInput('google-drive', ' 1AbCdEfGhIjKlMnOp ')).toBe('1AbCdEfGhIjKlMnOp');
  });

  it('leaves a OneDrive drive and item id as typed', () => {
    expect(folderFromInput('onedrive', 'b!drive/01ITEM')).toBe('b!drive/01ITEM');
  });
});
