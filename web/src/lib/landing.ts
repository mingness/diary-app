/**
 * Where sign-in lands (spec §4.1): the 報數 page, or the role's diary home. The choice is remembered on the
 * device, and 報數 is the default.
 */
import type { Role } from '@diary/shared';
import { readPref, writePref } from './storage.js';

export type Destination = 'diary' | 'count';

const DIARY_HOME: Record<Role, string> = {
  NORMAL_USER: '/diary',
  COURSE_LEADER: '/review',
  SYS_ADMIN: '/admin',
};

export function landingPath(role: Role, destination: Destination): string {
  return destination === 'count' ? '/count' : DIARY_HOME[role];
}

export function rememberedDestination(): Destination {
  return readPref('destination') === 'diary' ? 'diary' : 'count';
}

export function rememberDestination(destination: Destination): void {
  writePref('destination', destination);
}
