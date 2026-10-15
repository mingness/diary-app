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

test('the language switch shows the language in use, switches every string and is remembered', async ({
  page,
  t,
  lang,
}) => {
  const names = { 'zh-Hant': '中文', en: 'English' } as const;
  const other = lang === 'en' ? 'zh-Hant' : 'en';
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
  const languages = page.getByRole('group', { name: t('lang.label') });
  await expect(languages.getByRole('button', { name: names[lang] })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await languages.getByRole('button', { name: names[other] }).click();

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

test('English text uses Latin fonts first, so its punctuation isn’t full-width', async ({
  page,
  lang,
}) => {
  test.skip(lang !== 'en', 'Chinese keeps its full-width punctuation');
  await page.goto('/login');
  // The apostrophe's width relative to the text size, in the interface font and the diary font.
  const widths = await page.evaluate(() =>
    ['--font-ui', '--font-serif'].map((token) => {
      const span = document.createElement('span');
      span.style.fontFamily = `var(${token})`;
      span.style.fontSize = '100px';
      span.style.whiteSpace = 'pre';
      span.textContent = '’';
      document.body.append(span);
      const width = span.getBoundingClientRect().width / 100;
      span.remove();
      return width;
    }),
  );
  for (const width of widths) expect(width).toBeLessThan(0.5);
});
