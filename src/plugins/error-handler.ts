import type { FastifyError } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../lib/errors.js';

export default fp(
  async (app) => {
    app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
      if (err instanceof AppError) {
        return reply.code(err.statusCode).send({
          error: { code: err.code, message: err.message, details: err.details },
        });
      }

      if ('validation' in err && err.validation) {
        return reply.code(400).send({
          error: {
            code: 'validation_failed',
            message: err.message,
            details: err.validation.map((v) => ({
              path: v.instancePath || v.params?.missingProperty,
              message: v.message,
            })),
          },
        });
      }

      const status = err.statusCode ?? 500;
      if (status >= 500) {
        req.log.error({ err }, 'unhandled error');
        return reply
          .code(500)
          .send({ error: { code: 'internal_error', message: 'Internal server error' } });
      }

      // body parser errors, payload too large, etc.
      return reply.code(status).send({
        error: { code: err.code?.toLowerCase() ?? 'bad_request', message: err.message },
      });
    });

    app.setNotFoundHandler((req, reply) => {
      reply.code(404).send({
        error: { code: 'not_found', message: `Route ${req.method} ${req.url} not found` },
      });
    });
  },
  { name: 'error-handler' },
);
