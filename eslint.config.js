import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', 'db/migrations/**', 'docs/**'] },
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
    // In tests a missing value fails the test anyway, so `!` is a harmless shorthand there.
    files: ['**/test/**'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    files: ['scripts/**'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
