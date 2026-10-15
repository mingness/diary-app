/**
 * Builds the Fastify application. Kept separate from main.ts so tests can build an app against their own
 * database and log stream without starting a listener.
 *
 * Routes declare their request and response shapes as zod schemas (from `@diary/shared` where the web app
 * needs them too). Fastify validates requests and serialises responses with them, and the same schemas
 * produce the OpenAPI document behind the API explorer at /docs.
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { DestinationStream } from 'pino';
import { CSRF_HEADER, ErrorCode, REQUEST_ID_HEADER, type ErrorBody } from '@diary/shared';
import type { Config } from './config.js';
import { createContext, type AppContext } from './context.js';
import type { Database } from './db/client.js';
import { FailureThrottle } from './domain/auth/throttle.js';
import { HttpError, rateLimited } from './http-errors.js';
import { loggerOptions } from './logging.js';
import { installAuth } from './plugins/auth.js';
import { adminActivityRoutes } from './routes/admin-activity.js';
import { adminDocumentRoutes } from './routes/admin-documents.js';
import { adminUserRoutes } from './routes/admin-users.js';
import { authRoutes, DEFAULT_AUTH_LIMITS, type AuthLimits } from './routes/auth.js';
import { documentRoutes } from './routes/documents.js';
import { leaderRoutes } from './routes/leader.js';
import { countRoutes } from './routes/count.js';
import { adminCountRoutes } from './routes/admin-count.js';
import { internalRoutes } from './routes/internal.js';
import { translateRoutes } from './routes/translate.js';
import { healthRoutes } from './routes/health.js';
import { meRoutes } from './routes/me.js';

/** Largest accepted request body: one 8 MB document plus headroom (docs/ARCHITECTURE.md §8.3). */
export const BODY_LIMIT_BYTES = 10 * 1024 * 1024;

export interface AppDeps {
  config: Config;
  database: Database;
  /** Tests pass a stream to capture log lines; production logs to stdout. */
  logStream?: DestinationStream;
  /** Tests pin the time and the CAPTCHA question; production uses the real clock and random questions. */
  overrides?: Partial<Pick<AppContext, 'clock' | 'captchaQuestion' | 'mailer' | 'translator'>>;
  /** Per-IP limits on the auth endpoints; tests raise them so they can make many requests. */
  authLimits?: Partial<AuthLimits>;
}

/** Path of the API explorer (dev and staging only; see `API_DOCS`). The OpenAPI JSON is at `${API_DOCS_PATH}/json`. */
export const API_DOCS_PATH = '/docs';

export async function buildApp({
  config,
  database,
  logStream,
  overrides,
  authLimits,
}: AppDeps): Promise<FastifyInstance> {
  const ctx = createContext(config, database.db, overrides);
  const logger = logStream
    ? { ...loggerOptions(config.logLevel), stream: logStream }
    : loggerOptions(config.logLevel);

  const app = Fastify({
    logger,
    bodyLimit: BODY_LIMIT_BYTES,
    // Always generate our own ID; a client-supplied one could be used to forge log correlation.
    requestIdHeader: false,
    genReqId: () => randomUUID(),
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Must be registered before any route so it sees them all.
  if (config.apiDocs) {
    await app.register(swagger, {
      openapi: {
        info: {
          title: 'Cultivation Diary API',
          description:
            "Every endpoint, generated from the server's own request and response schemas. " +
            'Errors always have the shape {code, message, requestId}.\n\n' +
            '**Signing in here:** run GET /api/auth/captcha, then POST /api/auth/login with its id. With ' +
            'CAPTCHA_FIXED=true (the development default) the answer is always 3. The browser keeps the ' +
            'session cookie for you. Then press Authorize and paste the csrfToken from the login response.',
          version: '0.0.0',
        },
        components: {
          securitySchemes: {
            csrf: {
              type: 'apiKey',
              in: 'header',
              name: CSRF_HEADER,
              description:
                'Paste the csrfToken from the login (or GET /api/me) response. Needed for every request ' +
                'that changes something; the session itself travels in a cookie the browser sends for you.',
            },
          },
        },
        security: [{ csrf: [] }],
      },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: API_DOCS_PATH });
  }

  app.addHook('onRequest', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });

  app.setNotFoundHandler(async (request, reply) => {
    const body: ErrorBody = {
      code: ErrorCode.NotFound,
      message: 'Not found',
      requestId: request.id,
    };
    return reply.code(404).send(body);
  });

  app.setErrorHandler<FastifyError>(async (error, request, reply) => {
    const status = typeof error.statusCode === 'number' ? error.statusCode : 500;
    let body: ErrorBody;
    if (error.validation) {
      body = {
        code: ErrorCode.ValidationFailed,
        message: 'Invalid request',
        requestId: request.id,
      };
    } else if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      body = {
        code: ErrorCode.PayloadTooLarge,
        message: 'Request too large',
        requestId: request.id,
      };
    } else if (status < 500 || error instanceof HttpError) {
      // HttpErrors are raised on purpose with our own codes and messages (e.g. 504 translation_timeout), so
      // they are safe to show whatever their status; anything else at 5xx is unexpected.
      body = { code: error.code ?? 'bad_request', message: error.message, requestId: request.id };
      if (error instanceof HttpError && error.details) body.details = error.details;
    } else {
      // Stack traces go to the log only, never to the client.
      request.log.error({ err: error }, 'unhandled error');
      body = { code: ErrorCode.Internal, message: 'Internal error', requestId: request.id };
    }
    return reply.code(status >= 400 ? status : 500).send(body);
  });

  await app.register(rateLimit, { global: false, errorResponseBuilder: () => rateLimited() });
  await installAuth(app, ctx);

  healthRoutes(app, { pool: database.pool, migrationsDir: config.migrationsDir });
  // Shared by sign-in and password change, so guesses through either count toward one limit.
  const throttles = {
    password: new FailureThrottle({ maxFailures: 5, windowMs: 15 * 60 * 1000 }, ctx.clock),
    totp: new FailureThrottle({ maxFailures: 5, windowMs: 15 * 60 * 1000 }, ctx.clock),
  };
  authRoutes(app, ctx, { ...DEFAULT_AUTH_LIMITS, ...authLimits }, throttles);
  meRoutes(app, ctx, throttles);
  adminUserRoutes(app, ctx);
  adminActivityRoutes(app, ctx);
  adminDocumentRoutes(app, ctx);
  documentRoutes(app, ctx);
  leaderRoutes(app, ctx);
  countRoutes(app, ctx);
  adminCountRoutes(app, ctx, database.pool);
  internalRoutes(app, ctx, database.pool);
  translateRoutes(app, ctx);

  return app;
}
