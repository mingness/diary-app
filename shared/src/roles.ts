import { z } from 'zod';

/** Account roles. Each account has exactly one (docs/project_prompt.md §2). */
export const Role = z.enum(['NORMAL_USER', 'COURSE_LEADER', 'SYS_ADMIN']);
export type Role = z.infer<typeof Role>;

/** Who can read a diary entry besides its owner and the course leaders (§5.3). */
export const Access = z.enum(['private', 'wait_for_open', 'open']);
export type Access = z.infer<typeof Access>;
