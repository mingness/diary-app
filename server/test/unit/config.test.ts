import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config.js';

const hex = (char: string) => char.repeat(64);
const realisticHex = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

function validEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    DIARY_KEYRING: `v1:${realisticHex}`,
    PROFILE_KEYRING: `v1:${realisticHex.split('').reverse().join('')}`,
    SESSION_SECRET: realisticHex,
    CRON_SECRET: 'x'.repeat(16) + 'y'.repeat(16),
    ...overrides,
  };
}

function configErrorFor(env: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err;
    throw err;
  }
  throw new Error('expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('loads a valid environment with defaults', () => {
    const config = loadConfig(validEnv());
    expect(config.env).toBe('test');
    expect(config.port).toBe(3000);
    expect(config.diaryKeyring.current).toBe(1);
    expect(config.sessionSecret.length).toBe(32);
    expect(config.migrationsDir).toMatch(/db\/migrations$/);
  });

  it('names every missing variable at once', () => {
    const err = configErrorFor({ NODE_ENV: 'test' });
    expect(err.invalidVariables).toEqual([
      'CRON_SECRET',
      'DATABASE_URL',
      'DIARY_KEYRING',
      'PROFILE_KEYRING',
      'SESSION_SECRET',
    ]);
  });

  it('reports keyring and production problems alongside other invalid variables', () => {
    const err = configErrorFor(
      validEnv({
        NODE_ENV: 'production',
        DATABASE_URL: undefined,
        DIARY_KEYRING: 'v1:nothex',
        CRON_SECRET: 'change-me-change-me-change-me-change-me',
      }),
    );
    expect(err.invalidVariables).toEqual(['CRON_SECRET', 'DATABASE_URL', 'DIARY_KEYRING']);
  });

  it('rejects a malformed keyring by name', () => {
    expect(configErrorFor(validEnv({ DIARY_KEYRING: 'v1:nothex' })).invalidVariables).toEqual([
      'DIARY_KEYRING',
    ]);
  });

  it('never puts a secret value in the error message', () => {
    const secret = 'v1:' + 'Q'.repeat(64);
    const err = configErrorFor(validEnv({ DIARY_KEYRING: secret }));
    expect(err.message).not.toContain('QQQQ');
    expect(err.message).toContain('DIARY_KEYRING');
  });

  describe('in production', () => {
    it('refuses placeholder values from .env.example', () => {
      const err = configErrorFor(
        validEnv({
          NODE_ENV: 'production',
          CRON_SECRET: 'change-me-change-me-change-me-change-me',
        }),
      );
      expect(err.invalidVariables).toEqual(['CRON_SECRET']);
    });

    it('refuses an all-zero key', () => {
      const err = configErrorFor(
        validEnv({ NODE_ENV: 'production', DIARY_KEYRING: `v1:${hex('0')}` }),
      );
      expect(err.invalidVariables).toEqual(['DIARY_KEYRING']);
    });

    it('refuses the same keyring for diaries and profiles', () => {
      const same = `v1:${realisticHex}`;
      const err = configErrorFor(
        validEnv({ NODE_ENV: 'production', DIARY_KEYRING: same, PROFILE_KEYRING: same }),
      );
      expect(err.invalidVariables).toEqual(['PROFILE_KEYRING']);
    });

    it('accepts real-looking secrets', () => {
      expect(loadConfig(validEnv({ NODE_ENV: 'production' })).env).toBe('production');
    });
  });

  describe('SMTP (optional alert email)', () => {
    it('is off when unset or empty', () => {
      expect(loadConfig(validEnv()).smtp).toBeNull();
      expect(loadConfig(validEnv({ SMTP_URL: '', MAIL_FROM: '' })).smtp).toBeNull();
    });

    it('needs a sender address alongside the server', () => {
      expect(
        configErrorFor(validEnv({ SMTP_URL: 'smtps://a@qq.com:code@smtp.qq.com:465' }))
          .invalidVariables,
      ).toEqual(['MAIL_FROM']);
      expect(
        loadConfig(
          validEnv({ SMTP_URL: 'smtps://a@qq.com:code@smtp.qq.com:465', MAIL_FROM: 'a@qq.com' }),
        ).smtp,
      ).toEqual({ url: 'smtps://a@qq.com:code@smtp.qq.com:465', from: 'a@qq.com' });
    });

    it('rejects anything that is not an smtp(s) URL, and placeholders in production', () => {
      expect(
        configErrorFor(validEnv({ SMTP_URL: 'https://mail.example', MAIL_FROM: 'a@b.cn' }))
          .invalidVariables,
      ).toEqual(['SMTP_URL']);
      const prod = validEnv({
        NODE_ENV: 'production',
        SMTP_URL: 'smtps://a@qq.com:change-me@smtp.qq.com:465',
        MAIL_FROM: 'a@qq.com',
      });
      expect(configErrorFor(prod).invalidVariables).toEqual(['SMTP_URL']);
    });
  });

  describe('CAPTCHA_FIXED', () => {
    it('is off unless asked for', () => {
      expect(loadConfig(validEnv()).captchaFixed).toBe(false);
      expect(loadConfig(validEnv({ CAPTCHA_FIXED: 'true' })).captchaFixed).toBe(true);
    });

    it('is refused in production, by name, so a predictable CAPTCHA never reaches real users', () => {
      const err = configErrorFor(validEnv({ NODE_ENV: 'production', CAPTCHA_FIXED: 'true' }));
      expect(err.invalidVariables).toEqual(['CAPTCHA_FIXED']);
    });
  });

  describe('API_DOCS', () => {
    it('defaults to on outside production and off in production', () => {
      expect(loadConfig(validEnv()).apiDocs).toBe(true);
      expect(loadConfig(validEnv({ NODE_ENV: 'production' })).apiDocs).toBe(false);
    });

    it('can be set explicitly (staging runs production mode with docs on)', () => {
      expect(loadConfig(validEnv({ NODE_ENV: 'production', API_DOCS: 'true' })).apiDocs).toBe(true);
      expect(loadConfig(validEnv({ API_DOCS: 'false' })).apiDocs).toBe(false);
    });

    it('rejects anything but true or false', () => {
      expect(configErrorFor(validEnv({ API_DOCS: 'yes' })).invalidVariables).toEqual(['API_DOCS']);
    });
  });

  it('allows an all-zero key outside production (throwaway dev keys)', () => {
    expect(() => loadConfig(validEnv({ DIARY_KEYRING: `v1:${hex('0')}` }))).not.toThrow();
  });
});
