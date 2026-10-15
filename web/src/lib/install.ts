/**
 * Installing the app (spec §9.1): the browser's own install offer where there is one (Chrome-based
 * browsers), and how-to steps elsewhere: iPhone Safari, other Android browsers, and WeChat, where installing
 * isn't possible at all.
 */
import { useSyncExternalStore } from 'react';
import { readPref, writePref } from './storage.js';

/** The `beforeinstallprompt` event, not yet in TypeScript's DOM types. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let offer: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

/** Called once at start-up: the event fires early, before any screen could listen for it. */
export function captureInstallOffer(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    offer = event as InstallPromptEvent;
    listeners.forEach((listener) => listener());
  });
  window.addEventListener('appinstalled', () => {
    offer = null;
    listeners.forEach((listener) => listener());
  });
}

export function useInstallOffer(): InstallPromptEvent | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => offer,
  );
}

export async function install(): Promise<void> {
  if (!offer) return;
  await offer.prompt();
  await offer.userChoice;
  offer = null;
  listeners.forEach((listener) => listener());
}

export type Platform = 'installed' | 'wechat' | 'ios' | 'other';

/** Which how-to applies, from the user agent, display mode and touch support. */
export function platformOf(userAgent: string, standalone: boolean, touchPoints = 0): Platform {
  if (standalone) return 'installed';
  if (/MicroMessenger/i.test(userAgent)) return 'wechat';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  // iPads since iPadOS 13 say they are a Mac; only the touch screen tells them apart.
  if (/Macintosh/i.test(userAgent) && touchPoints > 1) return 'ios';
  return 'other';
}

export function currentPlatform(): Platform {
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return platformOf(navigator.userAgent, standalone, navigator.maxTouchPoints);
}

/** The one-time suggestion appears from the third visit on a phone (FRONTEND.md §9), until dismissed. */
export const VISITS_BEFORE_SUGGESTING = 3;

/** Counts this visit; called once per app start. */
export function countVisit(): number {
  const visits = Number(readPref('visits')) + 1 || 1;
  writePref('visits', String(visits));
  return visits;
}

export function shouldSuggestInstall(
  visits: number,
  platform: Platform,
  dismissed: boolean,
): boolean {
  return visits >= VISITS_BEFORE_SUGGESTING && platform !== 'installed' && !dismissed;
}

export const installDismissed = () => readPref('installDismissed') === 'true';
export const dismissInstall = () => writePref('installDismissed', 'true');
