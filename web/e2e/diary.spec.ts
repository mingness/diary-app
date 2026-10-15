/**
 * My diary, the entry view, the editor and open diaries (FRONTEND.md §4.2–4.4, spec §5–6). Each project
 * writes as its own seeded user, and global setup reseeds, so daily limits start fresh every run.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

/** The editor's address once its entry exists on the server (a new one starts at /diary/new/edit). */
const SAVED = /\/diary\/[0-9a-f-]{36}\/edit$/;

const editorBody = (page: Page) => page.locator('.ProseMirror[contenteditable="true"]');

/** A unique title, so a test finds its own entry among the seeded ones. */
const uniqueTitle = (word: string) => `${word} ${Date.now().toString(36)}`;

/** A photo far over the limits (4000×3000 of noise, which barely compresses), made in the page. */
async function bigPhoto(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4000;
    canvas.height = 3000;
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(4000, 3000);
    for (let i = 0; i < image.data.length; i++) {
      image.data[i] = i % 4 === 3 ? 255 : Math.random() * 255;
    }
    context.putImageData(image, 0, 0);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.95),
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  });
  return Buffer.from(base64, 'base64');
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
  ).toEqual([]);
}

test('write, save a draft, submit, then update with the earlier version kept in history', async ({
  userPage: page,
  t,
}) => {
  const title = uniqueTitle('E2E');
  await page.goto('/diary');
  await page.getByRole('link', { name: t('diary.write') }).click();

  const draft = page.getByRole('button', { name: t('editor.saveDraft') });
  const submit = page.getByRole('button', { name: t('editor.submit'), exact: true });
  await expect(draft).toBeDisabled();
  await expect(submit).toBeDisabled();

  await page.getByLabel(t('editor.title')).fill(title);
  await editorBody(page).click();
  await page.keyboard.type('First words.');
  await draft.click();

  // The first save creates the entry and gives the editor its own address, without losing anything.
  await expect(page).toHaveURL(SAVED);
  await expect(draft).toBeDisabled();
  await expect(submit).toBeEnabled();
  await submit.click();

  const update = page.getByRole('button', { name: t('editor.update'), exact: true });
  await expect(update).toBeDisabled();
  await editorBody(page).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' More.');
  await update.click();
  await expect(update).toBeDisabled();

  await page.getByRole('button', { name: t('editor.history') }).click();
  const history = page.getByRole('dialog', { name: t('history.title') });
  await history.getByText(t('history.version', { n: 1 })).click();
  await expect(history.getByText('First words.', { exact: true })).toBeVisible();
  await history.getByRole('button', { name: t('common.close') }).click();

  await page.getByRole('button', { name: t('common.back') }).click();
  const card = page.getByRole('link', { name: new RegExp(title) });
  await expect(card).toContainText(t('chip.submitted'));
});

test('formatting survives saving and reopening exactly', async ({ userPage: page, t }) => {
  await page.goto('/diary/new/edit');
  await page.getByLabel(t('editor.title')).fill(uniqueTitle('Format'));
  await editorBody(page).click();
  await page.getByLabel(t('editor.style')).selectOption('h2');
  await expect(editorBody(page)).toBeFocused();
  await page.keyboard.type('Heading');
  await page.keyboard.press('Enter');
  await page.getByLabel(t('editor.style')).selectOption('p');
  await page.getByLabel(t('editor.font')).selectOption('kai');
  await page.getByLabel(t('editor.size')).selectOption('large');
  // A menu keeps focus until the editor takes it back.
  await expect(editorBody(page)).toBeFocused();
  await page.getByRole('button', { name: t('editor.bold') }).click();
  await page.getByRole('button', { name: t('editor.underline') }).click();
  await page.keyboard.type('Styled');
  const before = await editorBody(page).innerHTML();
  await page.getByRole('button', { name: t('editor.saveDraft') }).click();
  await expect(page).toHaveURL(SAVED);
  await expect(page.getByRole('button', { name: t('editor.saveDraft') })).toBeDisabled();

  await page.reload();
  await expect(editorBody(page)).toContainText('Styled');
  // The server's sanitiser kept everything the editor wrote, so reopening shows the same and isn't "changed".
  expect(await editorBody(page).innerHTML()).toBe(before);
  await expect(page.getByRole('button', { name: t('editor.saveDraft') })).toBeDisabled();
  expect(before).toMatch(/<h2>Heading<\/h2>/);
  expect(before).toMatch(/<strong>|<u>/);
  expect(before).toContain('font-size: 1.25em');
  expect(before).toContain('Kaiti TC');
});

test.describe('photos (one project: generating them is slow)', () => {
  test.skip(({ lang, viewport }) => lang !== 'zh-Hant' || (viewport?.width ?? 0) >= 1024);

  test('large photos are made smaller with a notice, and a third is refused', async ({
    userPage: page,
    t,
  }) => {
    await page.goto('/diary/new/edit');
    const photo = await bigPhoto(page);
    const input = page.locator('input[type=file]');
    const button = page.getByRole('button', { name: t('editor.image') });

    for (let i = 0; i < 2; i++) {
      await input.setInputFiles({ name: 'big.jpg', mimeType: 'image/jpeg', buffer: photo });
      await expect(page.getByText(/4000×3000 .* → 1600×1200/)).toBeVisible({ timeout: 20_000 });
    }
    await expect(editorBody(page).locator('img')).toHaveCount(2);
    await expect(button).toBeDisabled();
    await expect(page.getByText(t('editor.imageLimit'))).toBeVisible();

    await page.getByRole('button', { name: t('editor.saveDraft') }).click();
    await expect(page).toHaveURL(SAVED);
    await page.reload();
    await expect(editorBody(page).locator('img')).toHaveCount(2);
  });
});

test('leaving with unsaved changes asks first, and keeping on writing loses nothing', async ({
  userPage: page,
  t,
}) => {
  await page.goto('/diary');
  await page.getByRole('link', { name: t('diary.write') }).click();
  await editorBody(page).click();
  await page.keyboard.type('Not saved yet');

  await page.getByRole('button', { name: t('common.back') }).click();
  const dialog = page.getByRole('dialog', { name: t('leave.title') });
  await dialog.getByRole('button', { name: t('leave.stay') }).click();
  await expect(dialog).toBeHidden();
  await expect(editorBody(page)).toContainText('Not saved yet');

  await page.getByRole('button', { name: t('common.back') }).click();
  await dialog.getByRole('button', { name: t('leave.save') }).click();
  await expect(page.getByRole('heading', { name: t('diary.title') })).toBeVisible();
  await expect(page.getByText(t('chip.draft')).first()).toBeVisible();
});

test('over 5,000 characters 提交 waits, but 暫存 still saves', async ({ userPage: page, t }) => {
  await page.goto('/diary/new/edit');
  await editorBody(page).click();
  await page.keyboard.insertText('念'.repeat(5_001));

  await expect(page.getByText(t('editor.tooLong', { max: '5,000' })).first()).toBeVisible();
  await expect(page.getByRole('button', { name: t('editor.submit'), exact: true })).toBeDisabled();
  await page.getByRole('button', { name: t('editor.saveDraft') }).click();
  await expect(page).toHaveURL(SAVED);
  await expect(page.getByRole('button', { name: t('editor.saveDraft') })).toBeDisabled();
});

test('sharing can be asked for once submitted, and withdrawn', async ({ userPage: page, t }) => {
  await page.goto('/diary/new/edit');
  const share = page.getByRole('checkbox', { name: t('share.label') });
  await expect(share).toBeDisabled();
  await editorBody(page).click();
  await page.keyboard.type('To share');
  await page.getByRole('button', { name: t('editor.submit'), exact: true }).click();
  await expect(share).toBeEnabled();

  await share.check();
  await expect(page.getByText(t('share.waiting'))).toBeVisible();
  await share.uncheck();
  await expect(page.getByText(t('share.waiting'))).toBeHidden();
  await expect(share).not.toBeChecked();
});

test('open diaries are readable by others, with their comments, and can’t be edited', async ({
  userPage: page,
  t,
  user,
}) => {
  await page.goto('/open');
  // Someone else's entry: the owner of an open entry rightly gets their own view, with 編輯.
  const month = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
  const list = await (await page.request.get(`/api/documents/open?month=${month}`)).json();
  const other = (list.documents as { id: string; author: { username: string } }[]).find(
    (d) => d.author.username !== user,
  );
  expect(other, 'the seed has an open entry by someone else this month').toBeTruthy();
  await page.locator(`a[href="/open/${other!.id}"]`).click();
  await expect(page).toHaveURL(/\/open\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('button', { name: t('translate.toEn') }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: t('entry.edit') })).toHaveCount(0);
  await page.getByRole('button', { name: t('common.back') }).click();
  await expect(page).toHaveURL(/\/open$/);
});

test.describe('the seeded user with an unseen comment', () => {
  test.skip(({ user }) => user !== 'chenmd');

  test('a new comment is marked on the card until the entry is opened', async ({
    userPage: page,
    t,
  }) => {
    await page.goto('/diary');
    const marked = page
      .getByRole('link')
      .filter({ hasText: t('chip.newComment') })
      .first();
    const title = (await marked.locator('span').first().textContent()) ?? '';
    await marked.click();
    await expect(page.getByText(t('entry.newComment'), { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: t('entry.commentLabel') })).toBeVisible();

    await page.getByRole('button', { name: t('common.back') }).click();
    const card = page.getByRole('link').filter({ hasText: title });
    await expect(card).not.toContainText(t('chip.newComment'));
  });
});

test('the diary screens pass axe in both themes and fit the phone at the largest text size', async ({
  userPage: page,
  t,
}) => {
  const screens: [string, string][] = [
    ['/diary', t('diary.title')],
    ['/open', t('open.title')],
    ['/diary/new/edit', t('editor.newTitle')],
  ];
  for (const [path, heading] of screens) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading })).toBeAttached();
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectNoAxeViolations(page);
    }
    await page.evaluate(() => (document.documentElement.style.fontSize = '22px'));
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
  await page.goto('/diary');
  await page.getByRole('main').getByRole('list').getByRole('link').first().click();
  await expect(page.getByRole('button', { name: t('translate.toEn') }).first()).toBeVisible();
  await expectNoAxeViolations(page);
});
