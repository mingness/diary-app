/**
 * CAPTCHA issue and check (spec §4.1). Single use: a CAPTCHA is deleted on its first check, right or wrong,
 * so each guess costs a new image. Expires after 5 minutes.
 */
import { randomUUID } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { captchas } from '../db/schema.js';
import { answerMatches, hashAnswer, renderCaptchaSvg } from '../domain/auth/captcha.js';

export const CAPTCHA_TTL_MS = 5 * 60 * 1000;

export async function issueCaptcha(ctx: AppContext): Promise<{ id: string; svg: string }> {
  const now = ctx.clock();
  const question = ctx.captchaQuestion();
  const id = randomUUID();
  // Clear out old ones as we go; cheap thanks to the expires_at index.
  await ctx.db.delete(captchas).where(lt(captchas.expiresAt, now));
  await ctx.db.insert(captchas).values({
    id,
    answerHash: hashAnswer(ctx.config.sessionSecret, id, question.answer),
    expiresAt: new Date(now.getTime() + CAPTCHA_TTL_MS),
  });
  return { id, svg: renderCaptchaSvg(question) };
}

/** True only for a live CAPTCHA with the right answer. Always uses the CAPTCHA up. */
export async function consumeCaptcha(
  ctx: AppContext,
  id: string,
  answer: string,
): Promise<boolean> {
  const [row] = await ctx.db.delete(captchas).where(eq(captchas.id, id)).returning();
  if (!row || row.expiresAt <= ctx.clock()) return false;
  return answerMatches(ctx.config.sessionSecret, id, answer, row.answerHash);
}
