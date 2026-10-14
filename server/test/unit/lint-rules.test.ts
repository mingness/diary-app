/**
 * The lint rules that keep the diary keyring away from SYS_ADMIN code are a security control, so they get a
 * test: if someone loosens eslint.config.js, this fails.
 */
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const cwd = fileURLToPath(new URL('../../../', import.meta.url));
const eslint = new ESLint({ cwd });

async function ruleIdsFor(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? m.message);
}

const readsKey = `export const k = (config: { diaryKeyring: unknown }) => config.diaryKeyring;\n`;
const destructuresKey = `export const k = ({ diaryKeyring }: { diaryKeyring: unknown }) => diaryKeyring;\n`;
const importsDiary = `import { x } from '../services/diary/vault.js';\nexport const y = x;\n`;

describe('diary keyring lint rules', () => {
  it.each([
    'server/src/routes/admin-users.ts',
    'server/src/services/admin-users.ts',
    'server/src/routes/auth.ts',
    'server/src/app.ts',
  ])('forbid reading the diary keyring in %s', async (file) => {
    expect(await ruleIdsFor(file, readsKey)).toContain('no-restricted-syntax');
    expect(await ruleIdsFor(file, destructuresKey)).toContain('no-restricted-syntax');
  });

  it('allow it in the diary module and the config loader', async () => {
    expect(await ruleIdsFor('server/src/services/diary/vault.ts', readsKey)).toEqual([]);
    expect(await ruleIdsFor('server/src/config.ts', readsKey)).toEqual([]);
  });

  it('forbid admin code from importing the diary module at all', async () => {
    expect(await ruleIdsFor('server/src/routes/admin-documents.ts', importsDiary)).toContain(
      'no-restricted-imports',
    );
    expect(await ruleIdsFor('server/src/services/admin-users.ts', importsDiary)).toContain(
      'no-restricted-imports',
    );
    expect(await ruleIdsFor('server/src/routes/documents.ts', importsDiary)).not.toContain(
      'no-restricted-imports',
    );
  });
});
