import { z } from 'zod';

/** Account roles. Each account has exactly one (docs/project_prompt.md §2). */
export const Role = z.enum(['NORMAL_USER', 'COURSE_LEADER', 'SYS_ADMIN']);
export type Role = z.infer<typeof Role>;
