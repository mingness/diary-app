/**
 * The installable app (slice 17): the manifest, the service worker and what it may cache, the offline
 * notice, and installing help.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

test.use({ suggestInstall: true });

/** Waits until the service worker controls the page (the first load only installs it). */
async function controlled(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

test('the manifest describes the app and its icons load', async ({ page }) => {
  const response = await page.request.get('/manifest.webmanifest');
  expect(response.headers()['content-type']).toContain('application/manifest+json');
  const manifest = (await response.json()) as {
    name: string;
    display: string;
    start_url: string;
    icons: { src: string; purpose?: string }[];
  };
  expect(manifest).toMatchObject({ name: '修行日記', display: 'standalone', start_url: '/' });
  expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  for (const icon of manifest.icons) {
    const image = await page.request.get(icon.src);
    expect(image.headers()['content-type'], icon.src).toBe('image/png');
  }
});

test('offline, the app still opens with a notice, and no API reply is ever cached', async ({
  userPage: page,
  t,
}) => {
  await page.goto('/');
  await controlled(page);
  // Load some diary content so there is something the service worker could have wrongly kept.
  await page.goto('/open');
  await page.waitForLoadState('networkidle');

  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      urls.push(...(await cache.keys()).map((request) => request.url));
    }
    return urls;
  });
  expect(cached.length).toBeGreaterThan(0);
  expect(cached.filter((url) => new URL(url).pathname.startsWith('/api/'))).toEqual([]);

  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: t('pwa.offline') })).toBeVisible();
  await page.context().setOffline(false);
  await expect(page.getByText(t('pwa.offline'))).toBeHidden();
});

test('the account page explains installing, and passes axe', async ({ userPage: page, t }) => {
  await page.goto('/me');
  await page.getByRole('button', { name: t('install.title') }).click();
  const sheet = page.getByRole('dialog', { name: t('install.title') });
  await expect(sheet.getByText(t('install.why'))).toBeVisible();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target)}`)).toEqual([]);
  }
});

test('a phone suggests installing from the third visit until dismissed', async ({
  userPage: page,
  t,
  isMobile,
}) => {
  test.skip(!isMobile, 'the suggestion is for phones');
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('diary.visits', '1');
    localStorage.removeItem('diary.installDismissed');
  });
  await page.reload(); // visit 2
  await expect(page.getByText(t('install.banner'))).toBeHidden();
  await page.reload(); // visit 3
  await expect(page.getByText(t('install.banner'))).toBeVisible();
  await page.getByRole('button', { name: t('install.dismiss') }).click();
  await expect(page.getByText(t('install.banner'))).toBeHidden();
  await page.reload();
  await expect(page.getByRole('navigation').first()).toBeVisible();
  await expect(page.getByText(t('install.banner'))).toBeHidden();
});
