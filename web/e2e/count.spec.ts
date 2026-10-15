/**
 * 報數 (FRONTEND.md §4.5, spec §7) and the SYS_ADMIN's 報數管理 (spec §6.5.3). Each project counts as its own
 * seeded user; the admin tools work on accounts the test creates.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, SEED_PASSWORD, test, unusedUsername } from './fixtures.js';

async function csrf(page: Page): Promise<string> {
  return (await (await page.request.get('/api/me')).json()).csrfToken as string;
}

test('input is cleaned as it is typed, with a notice for each change, and a report can replace the day’s', async ({
  userPage: page,
  t,
}) => {
  await page.goto('/count');
  const box = page.getByLabel(t('count.number'), { exact: true });

  await box.fill('12a');
  await expect(box).toHaveValue('12');
  await expect(page.getByText(t('count.notice.non_digits_removed'))).toBeVisible();
  await box.fill('5000');
  await expect(box).toHaveValue('1080');
  await expect(page.getByText(t('count.notice.clamped_to_max', { max: 1080 }))).toBeVisible();

  await box.fill('37');
  await page.getByRole('button', { name: t('count.submit'), exact: true }).click();
  await expect(page.getByText(t('count.submitted', { n: 37 }))).toBeVisible();
  // The day now has a number: the next report replaces it, and the page says so.
  await expect(page.getByText(t('count.replaces', { n: 37 }))).toBeVisible();
});

test('a missed day can be reported for, by choosing its date', async ({ userPage: page, t }) => {
  await page.goto('/count');
  const summary = await (await page.request.get('/api/count/summary')).json();
  const yesterday = summary.countDates[1] as string;
  await page.getByLabel(t('count.number'), { exact: true }).fill('21');
  await page.locator(`input[name="countDate"][value="${yesterday}"]`).check();
  await page.getByRole('button', { name: t('count.submit'), exact: true }).click();
  await expect(page.getByText(t('count.submitted', { n: 21 }))).toBeVisible();
  const after = await (await page.request.get('/api/count/summary')).json();
  const mine = (after.mine as { countDate: string; count: number | null }[]).find(
    (m) => m.countDate === yesterday,
  );
  expect(mine?.count).toBe(21);
});

test('自動報數 stays as chosen', async ({ userPage: page, t }) => {
  await page.goto('/count');
  const auto = page.getByRole('checkbox', { name: new RegExp(t('count.auto')) });
  const was = await auto.isChecked();
  await auto.setChecked(!was);
  await expect(page.getByText(t(was ? 'count.autoOff' : 'count.autoOn'))).toBeVisible();
  await page.reload();
  await expect(auto).toBeChecked({ checked: !was });
  await auto.setChecked(was);
  await expect(auto).toBeChecked({ checked: was });
});

test('報數 passes axe in both themes and fits at the largest text size', async ({
  userPage: page,
}) => {
  await page.goto('/count');
  await expect(page.getByRole('progressbar')).toBeVisible();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target)}`)).toEqual([]);
  }
  await page.evaluate(() => (document.documentElement.style.fontSize = '22px'));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
});

test('報數管理 switches a user’s automatic counting and runs the job', async ({
  adminPage: page,
  t,
}) => {
  const username = unusedUsername('cnt');
  const created = await page.request.post('/api/admin/users', {
    headers: { 'x-csrf-token': await csrf(page) },
    data: { username, role: 'NORMAL_USER', credentials: { password: SEED_PASSWORD } },
  });
  const { user } = (await created.json()) as { user: { id: string } };

  await page.goto('/count');
  await page.getByRole('link', { name: t('count.manage') }).click();
  await expect(page.getByRole('heading', { name: t('countAdmin.title') })).toBeVisible();

  const toggle = page.getByRole('checkbox', { name: t('countAdmin.autoFor', { name: username }) });
  await toggle.check();
  await expect(toggle).toBeChecked();
  // The box ticks at once (optimistic); the save lands a moment later.
  await expect
    .poll(async () => {
      const users = await (await page.request.get('/api/admin/count/users')).json();
      return (users.users as { userId: string; autoSubmit: boolean }[]).find(
        (u) => u.userId === user.id,
      )?.autoSubmit;
    })
    .toBe(true);

  await page.getByRole('button', { name: t('countAdmin.runNow') }).click();
  await expect(
    page.getByText(new RegExp(`${t('countAdmin.ran')}|${t('countAdmin.skipped')}`)),
  ).toBeVisible();
});

test('the account page saves the profile and lists this device', async ({ userPage: page, t }) => {
  await page.goto('/me');
  const address = page.getByRole('textbox', { name: new RegExp(`^${t('register.address')}`) });
  const value = `測試地址 ${Date.now() % 1000}`;
  await address.fill(value);
  await page.getByRole('button', { name: t('account.saveProfile') }).click();
  await expect(page.getByText(t('account.profileSaved'))).toBeVisible();
  await page.reload();
  await expect(address).toHaveValue(value);
  await expect(page.getByText(t('account.thisDevice'))).toBeVisible();
  // "儲存空間：已使用 1 KB" / "Storage: 1 KB used", whatever the size.
  const [before, after] = t('account.storage').split('{size}');
  await expect(
    page.getByText(`${before}`, { exact: false }).filter({ hasText: after ?? '' }),
  ).toBeVisible();
});

test.describe('one project only (it signs in a fresh account; the server allows 20 sign-ins a minute)', () => {
  test.skip(({ lang, viewport }) => lang !== 'en' || (viewport?.width ?? 0) < 1024);

  test('changing the password checks the current one and that the new ones match', async ({
    adminPage,
    browser,
    lang,
    t,
  }) => {
    // A fresh account: the change signs out the user's other devices, which other tests rely on.
    const username = unusedUsername('pwd');
    await adminPage.request.post('/api/admin/users', {
      headers: { 'x-csrf-token': await csrf(adminPage) },
      data: { username, role: 'NORMAL_USER', credentials: { password: 'first-password-1' } },
    });
    const context = await browser.newContext();
    await context.addInitScript((value) => localStorage.setItem('diary.lang', value), lang);
    const page = await context.newPage();
    const captcha = (await (await page.request.get('/api/auth/captcha')).json()) as { id: string };
    const signedIn = await page.request.post('/api/auth/login', {
      data: { username, password: 'first-password-1', captchaId: captcha.id, captchaAnswer: '3' },
    });
    expect(signedIn.ok(), `signing in the fresh account: ${signedIn.status()}`).toBe(true);
    await page.goto('/me');
    await page.getByRole('button', { name: t('account.password') }).click();
    const sheet = page.getByRole('dialog', { name: t('account.password') });
    const field = (key: Parameters<typeof t>[0]) => sheet.getByLabel(t(key), { exact: true });

    await field('account.currentPassword').fill('first-password-1');
    await field('account.newPassword').fill('second-password-2');
    await field('account.confirmPassword').fill('something-else-3');
    await sheet.getByRole('button', { name: t('account.changePassword') }).click();
    await expect(sheet.getByText(t('register.mismatch'))).toBeVisible();

    await field('account.currentPassword').fill('not-my-password');
    await field('account.confirmPassword').fill('second-password-2');
    await sheet.getByRole('button', { name: t('account.changePassword') }).click();
    await expect(sheet.getByText(t('error.wrong_password'))).toBeVisible();

    await field('account.currentPassword').fill('first-password-1');
    await sheet.getByRole('button', { name: t('account.changePassword') }).click();
    await expect(page.getByText(t('account.passwordChanged'))).toBeVisible();
    await page.context().close();
  });
});
