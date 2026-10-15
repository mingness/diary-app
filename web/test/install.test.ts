import { describe, expect, it } from 'vitest';
import { platformOf, shouldSuggestInstall } from '../src/lib/install.js';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const WECHAT_IPHONE = `${IPHONE} MicroMessenger/8.0.49(0x18003130) NetType/WIFI Language/zh_CN`;

describe('platformOf', () => {
  it('picks the how-to for each browser', () => {
    expect(platformOf(IPHONE, false)).toBe('ios');
    expect(platformOf(ANDROID, false)).toBe('other');
    // WeChat's browser can't install on any phone, so its advice wins over the iPhone steps.
    expect(platformOf(WECHAT_IPHONE, false)).toBe('wechat');
    expect(platformOf(IPHONE, true)).toBe('installed');
  });

  it('tells an iPad (which says it is a Mac) from a real Mac by its touch screen', () => {
    expect(platformOf(IPAD_AS_MAC, false, 5)).toBe('ios');
    expect(platformOf(IPAD_AS_MAC, false, 0)).toBe('other');
  });
});

describe('shouldSuggestInstall', () => {
  it('waits for the third visit and stops once dismissed or installed', () => {
    expect(shouldSuggestInstall(2, 'ios', false)).toBe(false);
    expect(shouldSuggestInstall(3, 'ios', false)).toBe(true);
    expect(shouldSuggestInstall(3, 'ios', true)).toBe(false);
    expect(shouldSuggestInstall(9, 'installed', false)).toBe(false);
  });
});
