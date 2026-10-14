/**
 * English text for emails the server writes itself (docs/ARCHITECTURE.md §8.10). The keys are fixed by the
 * Traditional Chinese table; a missing key here fails the type check.
 */
import type { ServerStrings } from './zh-Hant.js';

export const en: ServerStrings = {
  appName: 'Cultivation Diary',
  alertSubject: (username) => `Account needs attention: ${username}`,
  alertIntro: (username) => `The account "${username}" was flagged:`,
  rule: {
    limit_reached: 'Reached a daily or per-entry limit.',
    login_failures: 'Many failed sign-ins within an hour.',
    new_devices: 'Signed in from several new devices within a day.',
  },
  alertAction: 'Review it in the app under Attention (注意).',
  summarySubject: (open) => `Daily summary: ${open} open item(s) in Attention`,
  summaryOpen: (open) => `Open items in Attention: ${open}`,
  summaryNew: (count) => `New in the last 24 hours: ${count}`,
};
