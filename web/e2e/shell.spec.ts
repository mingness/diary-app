/**
 * The app shell (FRONTEND.md §1–3, §8): language, text size and theme, navigation, and accessibility in
 * both themes. Every screen built so far gets an axe check here.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
  ).toEqual([]);
}

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test('the language toggle switches every string and is remembered', async ({ page, t, lang }) => {
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
  await page.getByRole('button', { name: t('lang.switch') }).click();

  const other = lang === 'en' ? 'zh-Hant' : 'en';
  await expect(page.locator('html')).toHaveAttribute('lang', other);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', other);
  await expect(page.getByRole('button', { name: t('auth.login'), exact: true })).toHaveCount(0);
});

// One page load per screen: the server allows 60 CAPTCHAs a minute per address, and every public screen
// fetches one. The theme and text size can both change without a reload.
test('public screens pass axe in both themes and need no sideways scrolling at the largest size', async ({
  page,
}) => {
  for (const path of ['/login', '/register', '/forgot-password']) {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(path);
    await expect(page.getByRole('img').first()).toBeVisible();
    await expectNoAxeViolations(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectNoAxeViolations(page);
    await page.evaluate(() => (document.documentElement.style.fontSize = '22px'));
    await expectNoSidewaysScroll(page);
  }
});

test('the account screen passes axe in both themes', async ({ userPage, t }) => {
  await userPage.goto('/me');
  await expect(userPage.getByRole('heading', { name: t('account.appearance') })).toBeVisible();
  for (const scheme of ['light', 'dark'] as const) {
    await userPage.emulateMedia({ colorScheme: scheme });
    await expectNoAxeViolations(userPage);
  }
});

test('text size and theme are saved to the account and applied at once', async ({
  userPage,
  t,
}) => {
  await userPage.goto('/me');
  const html = userPage.locator('html');
  await userPage.getByRole('radio', { name: t('account.size22'), exact: true }).check();
  await userPage.getByRole('radio', { name: t('account.themeDark'), exact: true }).check();
  await expect(html).toHaveCSS('font-size', '22px');
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expectNoSidewaysScroll(userPage);

  // Stored on the server: a device with nothing cached gets them back after sign-in.
  await userPage.evaluate(() => localStorage.clear());
  await userPage.reload();
  await expect(html).toHaveCSS('font-size', '22px');
  await expect(html).toHaveAttribute('data-theme', 'dark');

  await userPage.getByRole('radio', { name: t('account.size18'), exact: true }).check();
  await userPage.getByRole('radio', { name: t('account.themeSystem'), exact: true }).check();
  await expect(html).toHaveCSS('font-size', '18px');
  await expect(html).not.toHaveAttribute('data-theme');
});

test('unknown addresses show "not found" inside the app', async ({ userPage, t }) => {
  await userPage.goto('/no-such-page');
  await expect(userPage.getByRole('heading', { name: t('state.notFound') })).toBeVisible();
  await expect(userPage.getByRole('navigation', { name: t('nav.label') })).toBeVisible();
});
