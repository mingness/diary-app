import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      'db/migrations/**',
      'docs/**',
      'web/test-results/**',
      'web/playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['error'] }],
    },
  },
  {
    // The web app runs in the browser, not Node.
    files: ['web/src/**'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // In tests a missing value fails the test anyway, so `!` is a harmless shorthand there.
    files: ['**/test/**', 'web/e2e/**'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    files: ['scripts/**'],
    rules: { 'no-console': 'off' },
  },
  {
    // Structural guarantee that SYS_ADMIN code can never decrypt diaries (docs/ARCHITECTURE.md §6.3):
    // only the config loader and the diary module may touch the diary keyring. Tests may, to check results.
    files: ['server/src/**'],
    ignores: ['server/src/config.ts', 'server/src/services/diary/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='diaryKeyring']",
          message:
            'Only server/src/services/diary/ may use the diary keyring (SYS_ADMIN must never be able to decrypt diaries).',
        },
        {
          selector: "ObjectPattern > Property[key.name='diaryKeyring']",
          message:
            'Only server/src/services/diary/ may use the diary keyring (SYS_ADMIN must never be able to decrypt diaries).',
        },
      ],
    },
  },
  {
    // Admin code works with account data only; it may not even import the diary module.
    files: ['server/src/routes/admin*', 'server/src/services/admin*'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/services/diary', '**/services/diary/**'],
              message: 'SYS_ADMIN code must not use the diary module, which can decrypt content.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
