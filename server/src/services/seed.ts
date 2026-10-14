/**
 * Development and test data (spec §11). Never runs in production; passwords and authenticator secrets are
 * throwaway. Entries are written through the real diary service, so they're encrypted exactly as real ones,
 * and dated over the past two weeks so calendars and month lists have something to show.
 *
 * Comments arrive with the comment API (delivery slice 6) and are seeded from then on.
 */
import { eq, sql } from 'drizzle-orm';
import type { Access, Profile, Role } from '@diary/shared';
import type { AppContext } from '../context.js';
import { documents, users } from '../db/schema.js';
import { generateTotpSecret } from '../domain/auth/totp.js';
import { AdminToolError, enableTotp } from './admin-tools.js';
import { createDocument, saveDraft, submitDocument } from './diary/documents.js';
import { createUser, type UserRow } from './users.js';

export const SEED_PASSWORD = 'password123';

interface SeedUser {
  readonly username: string;
  readonly role: Role;
  readonly profile: Profile;
  readonly resetPending?: boolean;
}

const person = (familyName: string, givenName: string, address = ''): Profile => ({
  familyName,
  givenName,
  address,
  photo: null,
});

export const SEED_USERS: readonly SeedUser[] = [
  { username: 'admin', role: 'SYS_ADMIN', profile: person('李', '志強') },
  { username: 'admin2', role: 'SYS_ADMIN', profile: person('陳', '志強') },
  { username: 'leader.lin', role: 'COURSE_LEADER', profile: person('林', '慧君') },
  { username: 'leader.huang', role: 'COURSE_LEADER', profile: person('黃', '志遠') },
  { username: 'chenmd', role: 'NORMAL_USER', profile: person('陳', '明德', '[地址 1]') },
  { username: 'zhangsf', role: 'NORMAL_USER', profile: person('張', '淑芬', '[地址 2]') },
  { username: 'wangdt', role: 'NORMAL_USER', profile: person('王', '大同') },
  { username: 'wuml', role: 'NORMAL_USER', profile: person('吳', '美玲') },
  { username: 'linjy', role: 'NORMAL_USER', profile: person('林', '佳穎') },
  { username: 'lijg', role: 'NORMAL_USER', profile: person('李', '建國') },
  { username: 'chenmh', role: 'NORMAL_USER', profile: person('陳', '美華'), resetPending: true },
];

const p = (...lines: string[]) => lines.map((l) => `<p>${l}</p>`).join('');

interface SeedEntry {
  readonly owner: string;
  readonly daysAgo: number;
  readonly title: string;
  /** Bodies submitted in order: the last is what leaders see, earlier ones become history versions. */
  readonly submissions: readonly string[];
  /** A pending draft after the submissions (or the only content, for an entry never submitted). */
  readonly draft?: string;
  readonly access?: Access;
}

/** Every state the spec's seed list asks for (§11): open, two waiting, a draft, a submitted-then-drafted. */
export const SEED_ENTRIES: readonly SeedEntry[] = [
  {
    owner: 'chenmd',
    daysAgo: 0,
    title: '晨起靜坐',
    submissions: [],
    draft: p('清晨五點半起床，在佛堂靜坐四十分鐘。', '明天想試試先拜佛再靜坐。'),
  },
  {
    owner: 'chenmd',
    daysAgo: 2,
    title: '念佛一小時',
    submissions: [p('晚上在家念佛一小時，用計數器記了一千零八十聲。')],
    access: 'open',
  },
  {
    owner: 'chenmd',
    daysAgo: 5,
    title: '與家人的對話',
    submissions: [p('和父親談起學佛的事，他第一次沒有反對。')],
    access: 'wait_for_open',
  },
  {
    owner: 'chenmd',
    daysAgo: 9,
    title: '早課心得',
    submissions: [
      p('早課時一直打瞌睡。'),
      p('早課時一直打瞌睡，後來站起來繞佛才清醒。'),
      p('早課時一直打瞌睡，後來站起來繞佛才清醒。<b>明天早點睡。</b>'),
    ],
  },
  {
    owner: 'chenmd',
    daysAgo: 12,
    title: '第一次參加共修',
    submissions: [p('第一次參加共修，人很多，有點緊張。')],
    draft: p('第一次參加共修，人很多，有點緊張。結束後師兄請我喝茶。'),
  },
  {
    owner: 'zhangsf',
    daysAgo: 0,
    title: '照顧母親的一天',
    submissions: [p('母親住院第三天。整天在病房，只能在走廊默念佛號。')],
    access: 'wait_for_open',
  },
  {
    owner: 'wangdt',
    daysAgo: 0,
    title: '讀經筆記',
    submissions: [p('今天讀《心經》，對「心無罣礙」有新的體會。')],
  },
  {
    owner: 'wuml',
    daysAgo: 1,
    title: '共修後的反省',
    submissions: [p('共修時一直在意旁邊的人念得太大聲。回家後想想，其實是自己的心不夠靜。')],
  },
  {
    owner: 'leader.lin',
    daysAgo: 3,
    title: '帶共修的反思',
    submissions: [p('今晚帶共修，提醒自己少說話，多聆聽。')],
  },
];

export interface SeedResult {
  readonly users: { username: string; role: Role; totpSecret?: string; resetPending: boolean }[];
  readonly entries: number;
}

/**
 * Loads development users and entries. Refuses in production, and refuses a database that already has users
 * unless `reset` is set (which deletes everything first).
 */
export async function seed(ctx: AppContext, options: { reset: boolean }): Promise<SeedResult> {
  if (ctx.config.env === 'production') {
    throw new AdminToolError('Refusing to seed a production database.');
  }
  const [{ n } = { n: 0 }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(users);
  if (n > 0 && !options.reset) {
    throw new AdminToolError(
      'The database already has users. Run with --reset to wipe and re-seed.',
    );
  }
  if (options.reset) await ctx.db.delete(users);

  const created = new Map<string, UserRow>();
  const result: SeedResult['users'] = [];
  for (const spec of SEED_USERS) {
    const user = await createUser(ctx, {
      username: spec.username,
      password: SEED_PASSWORD,
      role: spec.role,
      profile: spec.profile,
    });
    created.set(spec.username, user);
    let totpSecret: string | undefined;
    if (spec.role === 'SYS_ADMIN') {
      totpSecret = generateTotpSecret();
      await enableTotp(ctx, user, totpSecret, null);
    }
    if (spec.resetPending) {
      await ctx.db.update(users).set({ resetPending: true }).where(eq(users.id, user.id));
    }
    result.push({
      username: spec.username,
      role: spec.role,
      resetPending: spec.resetPending ?? false,
      ...(totpSecret ? { totpSecret } : {}),
    });
  }

  const now = ctx.clock().getTime();
  for (const entry of SEED_ENTRIES) {
    const owner = created.get(entry.owner);
    if (!owner) throw new Error(`seed entry for unknown user ${entry.owner}`);
    // Write as if on that day, so the entry date and timestamps look real.
    const dayCtx: AppContext = { ...ctx, clock: () => new Date(now - entry.daysAgo * 86_400_000) };
    const [first = '', ...later] = entry.submissions;
    const { document } = await createDocument(dayCtx, owner.id, {
      title: entry.title,
      body: entry.draft && entry.submissions.length === 0 ? entry.draft : first,
    });
    if (entry.submissions.length > 0) {
      await submitDocument(dayCtx, owner.id, document.id, { title: entry.title, body: first });
      for (const body of later) {
        await submitDocument(dayCtx, owner.id, document.id, { title: entry.title, body });
      }
      if (entry.draft) {
        await saveDraft(dayCtx, owner.id, document.id, { title: entry.title, body: entry.draft });
      }
    }
    if (entry.access) {
      // The sharing API arrives in slice 7; set the state directly for now.
      await ctx.db
        .update(documents)
        .set({ access: entry.access })
        .where(eq(documents.id, document.id));
    }
  }
  return { users: result, entries: SEED_ENTRIES.length };
}
