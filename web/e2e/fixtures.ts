/**
 * Shared test setup: each project's language and seeded user, the app's own string table (so tests read
 * the words a user sees in either language), and sign-in helpers.
 */
import { existsSync, readFileSync } from 'node:fs';
import { test as base, expect, type Browser, type Page } from '@playwright/test';
import { en } from '../src/i18n/en.js';
import { format, type Lang, type MessageKey, type Vars } from '../src/i18n/messages.js';
import { zhHant } from '../src/i18n/zh-Hant.js';

export { expect };

export interface E2eOptions {
  lang: Lang;
  /** The seeded user this project signs in as (all seeded passwords are SEED_PASSWORD). */
  user: string;
  /** The seeded course leader this project signs in as. */
  leader: string;
  /** Whether the phone's install suggestion may appear (it would get in the way of other tests). */
  suggestInstall: boolean;
}

export const SEED_PASSWORD = 'password123';
/** With CAPTCHA_FIXED=true (the dev and CI default) every CAPTCHA asks 1 + 2. */
export const CAPTCHA_ANSWER = '3';
export const AUTH_DIR = new URL('./.auth/', import.meta.url);

export function storageStateFor(user: string): string {
  return new URL(`${user}.json`, AUTH_DIR).pathname;
}

/** Facts from the seed run in global setup, such as the admins' authenticator keys. */
export function seedInfo(): { totpKeys: Record<string, string> } {
  const file = new URL('seed.json', AUTH_DIR);
  if (!existsSync(file)) throw new Error('global setup did not record the seed');
  return JSON.parse(readFileSync(file, 'utf8')) as { totpKeys: Record<string, string> };
}

interface Fixtures {
  t: (key: MessageKey, vars?: Vars) => string;
  /** A page already signed in as the project's user. */
  userPage: Page;
  /** A page already signed in as the project's course leader. */
  leaderPage: Page;
  /** A page already signed in as a SYS_ADMIN (shared by every project). */
  adminPage: Page;
}

export const test = base.extend<E2eOptions & Fixtures>({
  lang: ['zh-Hant', { option: true }],
  user: ['chenmd', { option: true }],
  leader: ['leader.lin', { option: true }],
  suggestInstall: [false, { option: true }],

  page: async ({ page, lang, suggestInstall }, use) => {
    await page.addInitScript(setUp, { lang, suggestInstall });
    await use(page);
  },

  t: async ({ lang }, use) => {
    const messages = lang === 'en' ? en : zhHant;
    await use((key, vars) => format(messages, key, vars));
  },

  userPage: async ({ browser, lang, user, suggestInstall }, use) => {
    const page = await signedInPage(browser, { lang, suggestInstall }, user);
    await use(page);
    await page.context().close();
  },

  leaderPage: async ({ browser, lang, leader, suggestInstall }, use) => {
    const page = await signedInPage(browser, { lang, suggestInstall }, leader);
    await use(page);
    await page.context().close();
  },

  adminPage: async ({ browser, lang, suggestInstall }, use) => {
    // Matches SESSION_ADMIN in global-setup.ts.
    const page = await signedInPage(browser, { lang, suggestInstall }, 'admin2');
    await use(page);
    await page.context().close();
  },
});

interface PageSetUp {
  lang: Lang;
  suggestInstall: boolean;
}

/** Runs in the page before the app: the project's language unless the test has switched it (the toggle
 * writes the same key), and the install suggestion out of the way unless the test is about it. */
function setUp({ lang, suggestInstall }: PageSetUp) {
  if (!localStorage.getItem('diary.lang')) localStorage.setItem('diary.lang', lang);
  if (!suggestInstall) localStorage.setItem('diary.installDismissed', 'true');
}

/** A new browser context with a session saved by global setup, in the project's language. */
async function signedInPage(browser: Browser, setup: PageSetUp, username: string): Promise<Page> {
  const context = await browser.newContext({ storageState: storageStateFor(username) });
  await context.addInitScript(setUp, setup);
  return context.newPage();
}

/** Fills the sign-in form (CAPTCHA included) and submits it. */
export async function signIn(
  page: Page,
  t: Fixtures['t'],
  username: string,
  password = SEED_PASSWORD,
): Promise<void> {
  await page.getByLabel(t('auth.username')).fill(username);
  await page.getByLabel(t('auth.password'), { exact: true }).fill(password);
  await page.getByLabel(t('auth.captchaAnswer')).fill(CAPTCHA_ANSWER);
  await page.getByRole('button', { name: t('auth.login'), exact: true }).click();
}

/** An optional text field, whose accessible name is its label followed by "(optional)". */
export function optionalField(page: Page, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.getByRole('textbox', { name: new RegExp(`^${escaped}（`) });
}

/** A username no account has, unique per call, so failures never throttle a real account. */
export function unusedUsername(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}
