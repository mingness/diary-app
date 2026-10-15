/**
 * The SYS_ADMIN screens (FRONTEND.md §4.8, spec §6.5): accounts, password resets, flags, activity and entry
 * metadata. Every project shares one administrator session; each test makes its own accounts and entries, so
 * none of them touches the seeded users the other tests sign in as.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { CAPTCHA_ANSWER, expect, test, unusedUsername } from './fixtures.js';

async function csrf(page: Page): Promise<string> {
  return (await (await page.request.get('/api/me')).json()).csrfToken as string;
}

/** A student created through the API, with a known password. */
async function student(admin: Page, prefix = 'stu'): Promise<{ id: string; username: string }> {
  const username = unusedUsername(prefix);
  const response = await admin.request.post('/api/admin/users', {
    headers: { 'x-csrf-token': await csrf(admin) },
    data: { username, role: 'NORMAL_USER', credentials: { password: 'student-pass-1' } },
  });
  expect(response.ok()).toBe(true);
  return { id: ((await response.json()) as { user: { id: string } }).user.id, username };
}

/** Whether a username and password sign in, through the API (one sign-in from the per-IP budget). */
async function canSignIn(page: Page, username: string, password: string): Promise<boolean> {
  const context = page.context().request;
  const captcha = (await (await context.get('/api/auth/captcha')).json()) as { id: string };
  const response = await page.request.post('/api/auth/login', {
    data: { username, password, captchaId: captcha.id, captchaAnswer: CAPTCHA_ANSWER },
  });
  return response.ok();
}

test('a new user gets a generated password, shown once, that works', async ({
  adminPage: page,
  browser,
  t,
}) => {
  const username = unusedUsername('new');
  await page.goto('/admin/users');
  await page.getByRole('link', { name: t('users.new') }).click();
  await page.getByLabel(t('userForm.username')).fill(username);
  await page.getByRole('textbox', { name: new RegExp(`^${t('register.familyName')}`) }).fill('新');
  await page.getByRole('button', { name: t('userForm.create') }).click();

  const dialog = page.getByRole('dialog', { name: t('password.title') });
  const password = ((await dialog.locator('p').last().textContent()) ?? '').trim();
  expect(password).toMatch(/^\S{8}$/);
  await dialog.getByRole('button', { name: t('password.done') }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/admin\/users\/[0-9a-f-]{36}$/);

  const fresh = await (await browser.newContext()).newPage();
  await fresh.goto('/login');
  expect(await canSignIn(fresh, username, password)).toBe(true);
  await fresh.context().close();
});

test('a locked account waits under 等待重設 until an administrator sets a password', async ({
  adminPage: page,
  t,
}) => {
  const { id, username } = await student(page, 'lock');
  const lock = await page.request.post(`/api/admin/users/${id}/lock`, {
    headers: { 'x-csrf-token': await csrf(page) },
  });
  expect(lock.ok()).toBe(true);

  await page.goto('/admin/users');
  await page.getByRole('radio', { name: new RegExp(t('users.waiting', { n: '\\d+' })) }).check();
  const row = page.getByRole('row').filter({ hasText: username });
  await expect(row).toContainText(t('admin.resetPending'));
  await row.getByRole('button', { name: t('users.setPassword') }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: t('userForm.typed') }).check();
  await dialog.getByLabel(t('userForm.password'), { exact: true }).fill('a-new-password-2');
  await dialog.getByRole('button', { name: t('users.setPassword') }).click();
  await expect(page.getByText(t('password.set'))).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: username })).toHaveCount(0);

  const user = await (await page.request.get(`/api/admin/users/${id}`)).json();
  expect(user.status).toBe('active');
});

test('editing a user saves their details; their own row never offers 刪除', async ({
  adminPage: page,
  t,
}) => {
  const { username } = await student(page, 'edit');
  await page.goto(`/admin/users?q=${username}`);
  const row = page.getByRole('row').filter({ hasText: username });
  await row.getByRole('link', { name: t('users.edit') }).click();
  await page.getByRole('textbox', { name: new RegExp(`^${t('register.givenName')}`) }).fill('改名');
  await page.getByLabel(t('users.role')).selectOption('COURSE_LEADER');
  await expect(page.getByText(t('userForm.roleChangeNote'))).toBeVisible();
  await page.getByRole('button', { name: t('userForm.save') }).click();
  await expect(page.getByText(t('userForm.saved'))).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('textbox', { name: new RegExp(`^${t('register.givenName')}`) }),
  ).toHaveValue('改名');
  await expect(page.getByLabel(t('users.role'))).toHaveValue('COURSE_LEADER');

  await page.goto('/admin/users?q=admin2');
  const mine = page.getByRole('row').filter({ hasText: 'admin2' });
  await expect(mine.getByRole('link', { name: t('users.edit') })).toBeVisible();
  await expect(mine.getByRole('button', { name: t('users.delete') })).toHaveCount(0);
});

test('several students are deleted together, after a confirmation', async ({
  adminPage: page,
  t,
}) => {
  const prefix = unusedUsername('bat');
  const a = await student(page, `${prefix}a`);
  const b = await student(page, `${prefix}b`);
  await page.goto(`/admin/users?q=${prefix}*`);
  for (const s of [a, b]) {
    await page.getByRole('checkbox', { name: t('users.select', { name: s.username }) }).check();
  }
  await page.getByRole('button', { name: t('users.deleteSelected') }).click();
  await page
    .getByRole('dialog', { name: t('users.deleteSelectedTitle', { n: 2 }) })
    .getByRole('button', { name: t('users.deleteSelected') })
    .click();
  await expect(page.getByText(t('users.deleted', { n: 2 }))).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: prefix })).toHaveCount(0);
});

test('an entry is found by its author and deleted, without its content ever shown', async ({
  adminPage: page,
  userPage,
  user,
  t,
}) => {
  const title = `AdminDel ${Date.now().toString(36)}`;
  const secret = 'Only the owner should read this sentence.';
  const created = await userPage.request.post('/api/documents', {
    headers: { 'x-csrf-token': await csrf(userPage) },
    data: { title, body: `<p>${secret}</p>` },
  });
  const { id } = (await created.json()) as { id: string };

  await page.goto('/admin/documents');
  await page.getByLabel(t('docs.username')).fill(user);
  await page.getByRole('button', { name: t('docs.search') }).click();
  const row = page.getByRole('row').filter({ hasText: title });
  await expect(row).toBeVisible();
  await expect(page.getByText(secret)).toHaveCount(0);

  await row.getByRole('button', { name: t('users.delete') }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: t('users.delete') })
    .click();
  await expect(page.getByText(t('docs.deleted'))).toBeVisible();
  expect((await userPage.request.get(`/api/documents/${id}`)).status()).toBe(404);
});

test('注意 lists flags to handle, and handling one moves it to 已處理', async ({
  adminPage: page,
  t,
}) => {
  await page.goto('/admin/attention');
  const cards = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: t('attention.markHandled') }) });
  // Test runs raise "unusually busy" flags for the seeded users; there's always one to handle.
  await expect(cards.first()).toBeVisible();
  const before = await cards.count();
  await cards
    .first()
    .getByRole('button', { name: t('attention.markHandled') })
    .click();
  await expect(cards).toHaveCount(before - 1);
  await page.getByRole('radio', { name: t('attention.handled') }).check();
  await expect(
    page.getByText(new RegExp(t('attention.handledAt', { time: '' }).trim())).first(),
  ).toBeVisible();
});

test('a user’s activity shows times and events, from the summary', async ({
  adminPage: page,
  user,
  t,
}) => {
  await page.goto('/admin/attention');
  await page.getByRole('link', { name: user, exact: true }).first().click();
  await expect(page).toHaveURL(/\/admin\/activity\?user=/);
  await expect(
    page.getByRole('heading', { name: t('activity.titleFor', { name: user }) }),
  ).toBeVisible();
  await page.getByLabel(t('activity.kind')).selectOption('login');
  await expect(
    page.getByRole('cell', { name: t('activity.kind.login'), exact: true }).first(),
  ).toBeVisible();
});

test('the admin screens pass axe in both themes and fit at the largest text size', async ({
  adminPage: page,
}) => {
  for (const path of [
    '/admin/attention',
    '/admin/users',
    '/admin/users/new',
    '/admin/documents',
    '/admin/activity',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('main').getByRole('heading').first()).toBeVisible();
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const results = await new AxeBuilder({ page }).analyze();
      expect(
        results.violations.map((v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target)}`),
      ).toEqual([]);
    }
    await page.evaluate(() => (document.documentElement.style.fontSize = '22px'));
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
    await page.evaluate(() => (document.documentElement.style.fontSize = ''));
  }
});
