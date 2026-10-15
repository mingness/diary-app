/**
 * The typed key set and the pure lookup behind `useT()`. Kept free of React so it can be unit-tested.
 */
import type { ErrorCode } from '@diary/shared';
import type { NETWORK_ERROR } from '../api/client.js';
import { zhHant } from './zh-Hant.js';

export type MessageKey = keyof typeof zhHant;
export type Messages = Record<MessageKey, string>;
export type Lang = 'zh-Hant' | 'en';

// Every error code the server can send needs words in the table; this line fails the type check otherwise.
type ErrorKeys = `error.${ErrorCode | typeof NETWORK_ERROR}`;
const _everyErrorCodeTranslated: Record<ErrorKeys, string> = zhHant;
void _everyErrorCodeTranslated;

export type Vars = Readonly<Record<string, string | number>>;

/** Looks up `key` and fills `{name}` placeholders; an unknown placeholder is left as written. */
export function format(messages: Messages, key: MessageKey, vars: Vars = {}): string {
  return messages[key].replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** The message for an API error code. Codes the app doesn't know yet read as a generic server error. */
export function errorKey(code: string): MessageKey {
  const key = `error.${code}`;
  return key in zhHant ? (key as MessageKey) : 'error.internal_error';
}
