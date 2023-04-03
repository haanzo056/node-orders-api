import { createHash } from 'node:crypto';
import fp from 'fastify-plugin';
import type { Db } from '../db/client.js';
import { AppError } from '../lib/errors.js';
import * as keys from '../repositories/idempotency-repository.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    idempotent?: boolean;
  }
  interface FastifyRequest {
    idempotencyKey?: string;
  }
}

export function hashRequest(method: string, url: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method} ${url}\n`)
    .update(JSON.stringify(body ?? null))
    .digest('hex');
}

// Runs as preHandler, so auth (onRequest) and body validation have already happened.
// Keys are scoped per user; the same key from two users is two different requests.
export default fp<{ db: Db }>(
  async (app, { db }) => {
    app.addHook('preHandler', async (req, reply) => {
      if (!req.routeOptions.config.idempotent) return;

      const key = req.headers['idempotency-key'];
      if (typeof key !== 'string' || key.length === 0 || key.length > 255) {
        throw new AppError(400, 'idempotency_key_required', 'Idempotency-Key header is required');
      }

      const userId = req.user.sub;
      const requestHash = hashRequest(req.method, req.url, req.body);

      if (await keys.claimKey(db, { userId, key, requestHash })) {
        req.idempotencyKey = key;
        return;
      }

      const existing = await keys.findKey(db, userId, key);
      if (!existing) {
        // claimed by someone else and released again between our two queries
        throw new AppError(409, 'request_in_progress', 'Concurrent request with this key, retry');
      }
      if (existing.requestHash !== requestHash) {
        throw new AppError(
          422,
          'idempotency_key_reused',
          'Idempotency-Key was already used for a different request',
        );
      }
      if (existing.statusCode === null) {
        // TODO: a crash mid-request leaves the key stuck here forever. Needs a cutoff
        // (e.g. treat in-progress rows older than a few minutes as abandoned).
        throw new AppError(409, 'request_in_progress', 'Original request is still being processed');
      }

      reply.header('idempotent-replayed', 'true');
      return reply.code(existing.statusCode).send(existing.responseBody);
    });

    app.addHook('onSend', async (req, reply, payload) => {
      const key = req.idempotencyKey;
      if (!key) return payload;

      // A 5xx says nothing about whether the request is safe to repeat, and caching it
      // would make the client's retry fail forever. Drop the key so the retry runs again.
      if (reply.statusCode >= 500) {
        await keys.releaseKey(db, req.user.sub, key);
        return payload;
      }

      const body = typeof payload === 'string' ? JSON.parse(payload) : null;
      await keys.completeKey(db, req.user.sub, key, reply.statusCode, body);
      return payload;
    });
  },
  { name: 'idempotency', dependencies: ['auth'] },
);
