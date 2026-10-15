/**
 * Sign-in, the authenticator steps, registration and forgot password (FRONTEND.md §4.1, spec §4), as a user
 * meets them in the browser. The rules behind them (throttles, locked accounts, CAPTCHA checks) are covered
 * by the server's integration tests.
 */
import { TOTP } from 'otpauth';
import { expect, optionalField, seedInfo, signIn, test, unusedUsername } from './fixtures.js';

function codeFor(secret: string): string {
  return new TOTP({ secret, digits: 6, period: 30 }).generate();
}

test('signing in lands in the app, survives a reload, and signing out returns to sign-in', async ({
  page,
  t,
  user,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page, t, user);

  // 報數 is the default destination (spec §4.1).
  await expect(page.getByRole('heading', { name: t('count.title') })).toBeVisible();
  await expect(page.getByRole('navigation', { name: t('nav.label') })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: t('count.title') })).toBeVisible();

  await page.getByRole('link', { name: t('nav.me'), exact: true }).click();
  await page.getByRole('button', { name: t('account.logout'), exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  // The old session is gone on the server too, not just forgotten by the page.
  await page.goto('/me');
  await expect(page).toHaveURL(/\/login$/);
});

test('a failed sign-in says why, offers a fresh CAPTCHA and keeps the username', async ({
  page,
  t,
}) => {
  await page.goto('/login');
  const image = page.getByRole('img', { name: t('auth.captchaImage') });
  const firstCaptcha = await image.getAttribute('src');
  const username = unusedUsername('nobody');

  await signIn(page, t, username, 'wrong-password');

  await expect(page.getByRole('alert')).toContainText(t('error.invalid_credentials'));
  await expect(image).not.toHaveAttribute('src', firstCaptcha ?? '');
  await expect(page.getByLabel(t('auth.captchaAnswer'))).toHaveValue('');
  await expect(page.getByLabel(t('auth.username'))).toHaveValue(username);
});

test('empty fields are named instead of being sent', async ({ page, t }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: t('auth.login'), exact: true }).click();
  await expect(
    page.getByText(t('auth.required', { field: t('auth.username') }), { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel(t('auth.username'))).toHaveAttribute('aria-invalid', 'true');
});

test.describe('administrators', () => {
  // Authenticator codes can't be reused, so these run in one project only.
  test.skip(({ lang, viewport }) => lang !== 'zh-Hant' || (viewport?.width ?? 0) < 1024);

  test('a SYS_ADMIN enters an authenticator code after the password', async ({ page, t }) => {
    await page.goto('/login');
    await signIn(page, t, 'admin');
    await expect(page.getByRole('heading', { name: t('totp.title') })).toBeVisible();

    await page.getByLabel(t('totp.code')).fill(codeFor(seedInfo().totpKeys.admin!));
    await page.getByRole('button', { name: t('totp.submit') }).click();
    // In, on 報數: the default destination after signing in (spec §4.1).
    await expect(page.getByRole('heading', { name: t('count.title') })).toBeVisible();
  });

  test('a new SYS_ADMIN must set up an authenticator before anything else', async ({
    page,
    adminPage,
    t,
  }) => {
    // Another administrator (the shared session) creates the account through the API.
    const me = await (await adminPage.request.get('/api/me')).json();
    const username = unusedUsername('admin');
    const created = await adminPage.request.post('/api/admin/users', {
      headers: { 'x-csrf-token': me.csrfToken },
      data: { username, role: 'SYS_ADMIN', credentials: { password: 'new-admin-pass' } },
    });
    expect(created.ok()).toBe(true);

    await page.goto('/login');
    await signIn(page, t, username, 'new-admin-pass');
    await expect(page.getByRole('heading', { name: t('enrol.title') })).toBeVisible();
    // Nothing else is reachable until the authenticator is confirmed.
    await page.goto('/me');
    await expect(page.getByRole('heading', { name: t('enrol.title') })).toBeVisible();

    const secret = (await page.getByText(/^[A-Z2-7]{16,}$/).textContent()) ?? '';
    await page.getByLabel(t('totp.code')).fill(codeFor(secret));
    await page.getByRole('button', { name: t('enrol.submit') }).click();
    // Set up: the page asked for (/me) now opens.
    await expect(page.getByRole('heading', { name: t('account.appearance') })).toBeVisible();
  });
});

test.describe('one project only (the server allows few of these per hour)', () => {
  test.skip(({ lang, viewport }) => lang !== 'zh-Hant' || (viewport?.width ?? 0) >= 1024);

  test('registering leads to sign-in with the username filled in, and the account works', async ({
    page,
    t,
  }) => {
    const username = unusedUsername('e2e');
    await page.goto('/login');
    await page.getByRole('link', { name: t('auth.toRegister') }).click();

    await page.getByLabel(t('auth.username')).fill(username);
    await optionalField(page, t('register.familyName')).fill('測');
    await optionalField(page, t('register.givenName')).fill('試');
    await page.getByLabel(t('auth.password'), { exact: true }).fill('long-enough-pass');
    await page.getByLabel(t('register.confirmPassword'), { exact: true }).fill('different-pass');
    await page.getByLabel(t('auth.captchaAnswer')).fill('3');
    await page.getByRole('button', { name: t('register.submit') }).click();
    // The mismatch is caught before anything is sent (spec §4.2).
    await expect(page.getByText(t('register.mismatch'))).toBeVisible();

    await page.getByLabel(t('register.confirmPassword'), { exact: true }).fill('long-enough-pass');
    await page.getByRole('button', { name: t('register.submit') }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('status').filter({ hasText: t('register.done') })).toBeVisible();
    await expect(page.getByLabel(t('auth.username'))).toHaveValue(username);
    await page.getByLabel(t('auth.password'), { exact: true }).fill('long-enough-pass');
    await page.getByLabel(t('auth.captchaAnswer')).fill('3');
    await page.getByRole('button', { name: t('auth.login'), exact: true }).click();
    await page.getByRole('link', { name: t('nav.me'), exact: true }).click();
    await expect(page.getByText('測試', { exact: true })).toBeVisible();
  });

  test('forgot password confirms it was passed to the administrators', async ({ page, t }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: t('auth.toForgot') }).click();
    // An unknown name gets the same answer, which keeps the test from locking a seeded account.
    await page.getByLabel(t('auth.username')).fill(unusedUsername('nobody'));
    await page.getByLabel(t('auth.captchaAnswer')).fill('3');
    await page.getByRole('button', { name: t('forgot.submit') }).click();
    await expect(page.getByText(t('forgot.done'))).toBeVisible();
  });
});
