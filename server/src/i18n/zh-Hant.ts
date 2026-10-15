/**
 * Traditional Chinese text for emails the server writes itself (docs/ARCHITECTURE.md §8.10). This file defines
 * the keys; en.ts must provide the same ones. Emails contain usernames and rule names only, never content.
 */
import type { AlertRule } from '../domain/limits/attention.js';

export interface ServerStrings {
  appName: string;
  alertSubject: (username: string) => string;
  alertIntro: (username: string) => string;
  rule: Record<AlertRule, string>;
  alertAction: string;
  summarySubject: (open: number) => string;
  summaryOpen: (open: number) => string;
  summaryNew: (count: number) => string;
}

export const zhHant: ServerStrings = {
  appName: '修行日記',
  alertSubject: (username) => `帳戶需要注意：${username}`,
  alertIntro: (username) => `帳戶「${username}」已被標記：`,
  rule: {
    limit_reached: '已達每日上限，有操作被拒絕。',
    elevated_activity: '今日活動量偏高（已達警示門檻）。',
    login_failures: '一小時內多次登入失敗。',
    new_devices: '一天內從多個新裝置登入。',
  },
  alertAction: '請在應用程式的「注意」頁查看。',
  summarySubject: (open) => `每日摘要：「注意」有 ${open} 項未處理`,
  summaryOpen: (open) => `「注意」中未處理的項目：${open}`,
  summaryNew: (count) => `過去 24 小時新增：${count}`,
};
