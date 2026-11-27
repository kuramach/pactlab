import { expect, test, type Page } from '@playwright/test';

/**
 * T-171: the site in English, German, French and Japanese, and the edge's
 * country detection with the CloudFront-Viewer-Country header stubbed.
 */
const country = (code: string) => ({ extraHTTPHeaders: { 'CloudFront-Viewer-Country': code } });

async function expectLanguage(page: Page, lang: string) {
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
}

test.describe('one page per language @smoke', () => {
  for (const { path, lang, heading } of [
    { path: '/', lang: 'en', heading: 'The machine does the diligence. You make the call.' },
    { path: '/de/how-it-works/', lang: 'de', heading: 'Evidenz rein. Belastbare Konditionen raus.' },
    { path: '/fr/faq/', lang: 'fr', heading: 'Les questions sur Pactlab, selon qui les pose' },
    { path: '/ja/industries/software-saas/', lang: 'ja', heading: 'マルチプルを払う前に、そのARRが本物かを確かめる。' },
  ]) {
    test(`${lang}: ${path}`, async ({ page }) => {
      await page.goto(path);
      await expectLanguage(page, lang);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      // hreflang for every language, plus x-default.
      for (const alternate of ['en', 'de', 'fr', 'ja', 'x-default']) await expect(page.locator(`link[rel="alternate"][hreflang="${alternate}"]`)).toHaveCount(1);
    });
  }
});

test.describe('country detection at the edge @smoke', () => {
  for (const { code, landing } of [
    { code: 'DE', landing: '/de/' },
    { code: 'AT', landing: '/de/' },
    { code: 'FR', landing: '/fr/' },
    { code: 'JP', landing: '/ja/' },
  ]) {
    test.describe(`a first visit from ${code}`, () => {
      test.use(country(code));
      test(`lands on ${landing}`, async ({ page }) => {
        await page.goto('/');
        await expect(page).toHaveURL(landing);
        await expectLanguage(page, landing.slice(1, 3));
      });
    });
  }

  test.describe('a first visit from the US, the UK or India', () => {
    for (const code of ['US', 'GB', 'IN']) {
      test.describe(code, () => {
        test.use(country(code));
        test('stays on English', async ({ page }) => {
          await page.goto('/');
          await expect(page).toHaveURL('/');
          await expectLanguage(page, 'en');
        });
      });
    }
  });

  test.describe('a visitor from Japan', () => {
    test.use(country('JP'));

    test('keeps the path when detected, and is never redirected from a deeper page', async ({ page }) => {
      await page.goto('/faq/');
      await expect(page).toHaveURL('/ja/faq/');
      await page.goto('/industries/fintech/');
      await expect(page).toHaveURL('/industries/fintech/');
      await expectLanguage(page, 'en');
    });

    test('who chooses English stays on English on the return visit', async ({ page, context }) => {
      await page.goto('/');
      await expect(page).toHaveURL('/ja/');
      await page.getByRole('banner').getByLabel(/言語/).first().click();
      await page.getByRole('link', { name: 'English' }).first().click();
      await expect(page).toHaveURL('/');
      await expectLanguage(page, 'en');
      expect((await context.cookies()).find((cookie) => cookie.name === 'pactlab_locale')?.value).toBe('en');
      // The return visit: the manual choice wins over the country, so no redirect.
      await page.goto('/');
      await expect(page).toHaveURL('/');
      await expectLanguage(page, 'en');
    });

    test('who chooses French lands on French on the return visit', async ({ page }) => {
      await page.goto('/how-it-works/');
      await expect(page).toHaveURL('/ja/how-it-works/');
      await page.getByRole('banner').getByLabel(/言語/).first().click();
      await page.getByRole('link', { name: 'Français' }).first().click();
      await expect(page).toHaveURL('/fr/how-it-works/');
      await page.goto('/');
      await expect(page).toHaveURL('/fr/');
      await expectLanguage(page, 'fr');
    });
  });

  test.describe('a visitor from Germany', () => {
    test.use(country('DE'));
    test('finds the country pre-filled in the pilot request', async ({ page }) => {
      await page.goto('/de/industries/fintech/');
      const pilot = page.getByRole('link', { name: 'Pilot anfragen', exact: true }).first();
      await expect(pilot).toHaveAttribute('href', /body=Land%3A%20Deutschland/);
    });
  });
});

test.describe('layout in every language @regression', () => {
  for (const lang of ['de', 'fr', 'ja']) {
    for (const path of ['/', '/industries/software-saas/', '/industries/multifamily/']) {
      for (const viewport of [
        { width: 1280, height: 900 },
        { width: 390, height: 844 },
      ]) {
        test(`${lang}${path} at ${viewport.width}px has no horizontal overflow`, async ({ page }) => {
          await page.setViewportSize(viewport);
          await page.goto(`/${lang}${path}`);
          await expectLanguage(page, lang);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          expect(overflow).toBeLessThanOrEqual(0);
        });
      }
    }
  }
});

test.describe('Pactlab Rinse download page (T-178c) @smoke', () => {
  for (const { path, lang, heading, platforms } of [
    { path: '/rinse/', lang: 'en', heading: 'Rinse your deal documents clean before they go in the room.', platforms: ['macOS (Apple Silicon)', 'macOS (Intel)', 'Windows', 'Linux'] },
    { path: '/de/rinse/', lang: 'de', heading: 'Bereinigen Sie Ihre Deal-Dokumente, bevor sie in den Datenraum gehen.', platforms: ['macOS (Apple Silicon)', 'macOS (Intel)', 'Windows', 'Linux'] },
    { path: '/fr/rinse/', lang: 'fr', heading: 'Nettoyez vos documents de transaction avant qu’ils n’entrent dans la salle.', platforms: ['macOS (Apple Silicon)', 'macOS (Intel)', 'Windows', 'Linux'] },
    { path: '/ja/rinse/', lang: 'ja', heading: '案件の書類は、データルームに入れる前にきれいに整えましょう。', platforms: ['macOS（Apple Silicon）', 'macOS（Intel）', 'Windows', 'Linux'] },
  ]) {
    test(`${lang}: lists the current release, its installers and checksums`, async ({ page }) => {
      await page.goto(path);
      await expectLanguage(page, lang);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page.getByText('0.1.0').first()).toBeVisible();
      await expect(page.getByRole('link', { name: /(Download|herunterladen|Télécharger|ダウンロード)/ })).toHaveCount(4);
      for (const platform of platforms) await expect(page.getByRole('heading', { name: platform, level: 3 })).toBeVisible();
      await expect(page.getByText('1'.repeat(64))).toBeVisible();
      await expect(page.getByRole('status')).toHaveCount(0);
    });
  }
});
