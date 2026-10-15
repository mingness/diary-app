/**
 * 翻譯 / Translate (spec §8). Takes an entry or comment ID, checks the caller may read it, and sends only its
 * plain text to the provider. Capped per user per hour, because each call costs money.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ErrorCode, TRANSLATE_LIMITS, TranslateRequest, TranslateResponse } from '@diary/shared';
import type { AppContext } from '../context.js';
import { Capability } from '../domain/authz/policy.js';
import { FailureThrottle } from '../domain/auth/throttle.js';
import { HttpError, rateLimited } from '../http-errors.js';
import { authOf, requireCapability } from '../plugins/auth.js';
import { commentText, documentText } from '../services/diary/translation-source.js';
import { TranslationError } from '../services/translator.js';

const HOUR = 60 * 60 * 1000;

export function translateRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Counts translations (not failures) per user; in memory, like the sign-in throttle.
  const perUser = new FailureThrottle(
    { maxFailures: TRANSLATE_LIMITS.perUserPerHour, windowMs: HOUR },
    ctx.clock,
  );

  app.withTypeProvider<ZodTypeProvider>().post(
    '/api/translate',
    {
      onRequest: requireCapability(Capability.Translate),
      schema: {
        tags: ['translate'],
        summary:
          '翻譯 (en_to_zh) or Translate (zh_to_en) an entry or a comment I may read. Plain text back; 504 after ' +
          `10 seconds; at most ${TRANSLATE_LIMITS.perUserPerHour} per hour.`,
        body: TranslateRequest,
        response: { 200: TranslateResponse },
      },
    },
    async (request) => {
      const { actor } = authOf(request);
      const translator = ctx.translator;
      if (!translator) {
        throw new HttpError(503, ErrorCode.TranslationUnavailable, 'Translation is not configured');
      }
      if (perUser.isBlocked(actor.id)) throw rateLimited();

      const body = request.body;
      const text =
        'documentId' in body
          ? await documentText(ctx, actor, body.documentId)
          : await commentText(ctx, actor, body.commentId);
      if (text === '') return { text: '' };
      if (text.length > TRANSLATE_LIMITS.maxChars) {
        throw new HttpError(413, ErrorCode.TooLarge, 'Too long to translate', {
          maxChars: TRANSLATE_LIMITS.maxChars,
        });
      }

      perUser.recordFailure(actor.id);
      const started = Date.now();
      try {
        const translated = await translator.translate(text, body.direction);
        // Sizes and timing only: never the text.
        request.log.info(
          {
            event: 'translated',
            direction: body.direction,
            chars: text.length,
            ms: Date.now() - started,
          },
          'translated',
        );
        return { text: translated };
      } catch (err) {
        if (!(err instanceof TranslationError)) throw err;
        request.log.warn(
          { event: 'translate_failed', reason: err.reason, ms: Date.now() - started },
          'translation failed',
        );
        throw err.reason === 'timeout'
          ? new HttpError(504, ErrorCode.TranslationTimeout, 'Translation took too long')
          : new HttpError(502, ErrorCode.TranslationFailed, 'Translation failed');
      }
    },
  );
}
