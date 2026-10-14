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
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import type { DestinationStream } from 'pino';
import { ErrorCode, REQUEST_ID_HEADER, type ErrorBody } from '@diary/shared';
import type { Config } from './config.js';
import type { Database } from './db/client.js';
import { loggerOptions } from './logging.js';
import { healthRoutes } from './routes/health.js';

/** Largest accepted request body: one 8 MB document plus headroom (docs/ARCHITECTURE.md §8.3). */
export const BODY_LIMIT_BYTES = 10 * 1024 * 1024;

export interface AppDeps {
  config: Pick<Config, 'logLevel' | 'migrationsDir' | 'apiDocs'>;
  database: Database;
  /** Tests pass a stream to capture log lines; production logs to stdout. */
  logStream?: DestinationStream;
}

/** Path of the API explorer (dev and staging only; see `API_DOCS`). The OpenAPI JSON is at `${API_DOCS_PATH}/json`. */
export const API_DOCS_PATH = '/docs';

export async function buildApp({ config, database, logStream }: AppDeps): Promise<FastifyInstance> {
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
            'Errors always have the shape {code, message, requestId}.',
          version: '0.0.0',
        },
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
    } else if (status < 500) {
      body = { code: error.code ?? 'bad_request', message: error.message, requestId: request.id };
    } else {
      // Stack traces go to the log only, never to the client.
      request.log.error({ err: error }, 'unhandled error');
      body = { code: ErrorCode.Internal, message: 'Internal error', requestId: request.id };
    }
    return reply.code(status >= 400 ? status : 500).send(body);
  });

  healthRoutes(app, { pool: database.pool, migrationsDir: config.migrationsDir });

  return app;
}
