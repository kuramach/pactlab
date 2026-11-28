import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHANNEL_PREFIX, PUSH_BADGE, PUSH_ICON, pushPayload } from '@pactlab/domain';
import { describe, expect, it } from 'vitest';
import manifest from '../app/manifest';

const worker = readFileSync(join(__dirname, '..', 'public', 'push-sw.js'), 'utf8');

/** T-146: Pactlab is installable for iOS web push, and its service worker does notifications and nothing else. */
describe('the web app manifest and the push service worker', () => {
  it('is installable as a standalone app named Pactlab, with the brand icons the site already serves', () => {
    const app = manifest();
    expect(app).toMatchObject({ name: 'Pactlab', short_name: 'Pactlab', display: 'standalone', start_url: '/' });
    for (const icon of app.icons ?? []) expect(readFileSync(join(__dirname, '..', 'public', icon.src)).length).toBeGreaterThan(0);
  });

  it('caches nothing and handles no fetches: notifications only', () => {
    expect(worker).not.toMatch(/addEventListener\(\s*['"]fetch['"]/);
    expect(worker).not.toMatch(/caches\./);
    expect(worker).toMatch(/addEventListener\('push'/);
    expect(worker).toMatch(/addEventListener\('notificationclick'/);
  });

  it('opens only same-origin paths, and its fallback words are the shared template', () => {
    expect(worker).toContain("data.url.startsWith('/') && !data.url.startsWith('//')");
    expect(worker).toContain('target.origin !== self.location.origin');
    const payload = pushPayload();
    expect(worker).toContain(payload.body);
    expect(payload.body.startsWith(CHANNEL_PREFIX)).toBe(true);
    for (const asset of [PUSH_ICON, PUSH_BADGE]) {
      expect(worker).toContain(asset);
      expect(readFileSync(join(__dirname, '..', 'public', asset)).length).toBeGreaterThan(0);
    }
  });
});
