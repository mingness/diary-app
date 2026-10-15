/**
 * Translation (spec §8). The request names an entry or a comment, never free text: the server checks the caller
 * may read it and fetches the text itself, so the endpoint can't be used as a general-purpose LLM.
 */
import { z } from 'zod';

/** 翻譯: English → 繁體中文. Translate: 繁體中文 → English. */
export const TranslateDirection = z.enum(['en_to_zh', 'zh_to_en']);
export type TranslateDirection = z.infer<typeof TranslateDirection>;

export const TranslateRequest = z.union([
  z.object({ documentId: z.uuid(), direction: TranslateDirection }).strict(),
  z.object({ commentId: z.uuid(), direction: TranslateDirection }).strict(),
]);
export type TranslateRequest = z.infer<typeof TranslateRequest>;

/** Plain text: show it as text below the buttons, never as HTML (spec §8). */
export const TranslateResponse = z.object({ text: z.string() });
