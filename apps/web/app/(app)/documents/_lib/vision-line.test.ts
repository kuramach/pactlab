import { describe, expect, it } from 'vitest';
import { visionLine } from './view';

describe('reading images, said plainly in the library (T-121)', () => {
  const base = { pagesTotal: 12, pagesDone: 3, failures: [] };
  it('says nothing when there is nothing to read', () => {
    expect(visionLine(undefined)).toBeNull();
    expect(visionLine({ ...base, status: 'NONE' })).toBeNull();
  });
  it('shows progress, then done with a reminder to check against the original', () => {
    expect(visionLine({ ...base, status: 'READING' })).toEqual({ text: 'Reading images… 3 of 12', retry: false });
    expect(visionLine({ ...base, status: 'DONE', pagesDone: 12 })?.text).toBe('Read from images (12 pages): check against the original');
  });
  it('names the first page it could not read, and offers Read again', () => {
    const line = visionLine({ ...base, status: 'PARTIAL', pagesDone: 10, failures: [{ page: 7, reason: 'Nothing legible on this page.' }, { page: 9, reason: 'x' }] });
    expect(line).toEqual({ text: 'Read 10 of 12 pages from images; couldn’t read page 7: Nothing legible on this page. (and 1 more)', retry: true });
    expect(visionLine({ ...base, status: 'FAILED', failures: [{ page: 1, reason: 'AI is off in this environment.' }] })).toEqual({ text: 'Images not read: couldn’t read page 1: AI is off in this environment.', retry: true });
    expect(visionLine({ ...base, status: 'SKIPPED' })?.retry).toBe(false);
  });
});
