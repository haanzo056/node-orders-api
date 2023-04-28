import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '../db/client.js';
import type { JobQueue } from '../jobs/queues.js';
import { AppError } from '../lib/errors.js';
import { verifySignature } from '../lib/webhook-signature.js';
import { insertEvent } from '../repositories/webhook-event-repository.js';
import { HANDLED_EVENT_TYPES, paymentEventSchema } from '../schemas/webhooks.js';

interface Options {
  secret: string;
  db: Db;
  queue: JobQueue;
}

const webhookRoutes: FastifyPluginAsync<Options> = async (app, { secret, db, queue }) => {
  // The signature covers the exact bytes received, so in this scope the body stays a
  // Buffer and we parse it ourselves after verifying.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer', bodyLimit: 256 * 1024 },
    (_req, body, done) => done(null, body),
  );

  app.post(
    '/webhooks/payments',
    { config: { rateLimit: false }, schema: { hide: true } },
    async (req, reply) => {
      const signature = req.headers['stripe-signature'];
      const raw = req.body;
      if (
        !Buffer.isBuffer(raw) ||
        typeof signature !== 'string' ||
        !verifySignature(raw, signature, secret)
      ) {
        throw new AppError(400, 'invalid_signature', 'Webhook signature verification failed');
      }

      let json: unknown;
      try {
        json = JSON.parse(raw.toString('utf8'));
      } catch {
        throw new AppError(400, 'invalid_payload', 'Body is not valid JSON');
      }

      const parsed = paymentEventSchema.safeParse(json);
      if (!parsed.success) {
        throw new AppError(400, 'invalid_payload', 'Unrecognised event shape');
      }
      const event = parsed.data;

      if (!HANDLED_EVENT_TYPES.has(event.type)) {
        req.log.debug({ eventId: event.id, type: event.type }, 'ignoring webhook event');
        return reply.send({ received: true });
      }

      // Enqueue even if the row already existed: a previous delivery may have been stored
      // but failed to enqueue. The jobId dedupes, and the job skips processed events.
      await insertEvent(db, { id: event.id, type: event.type, payload: event });
      await queue.enqueuePaymentWebhook(event.id);
      return reply.send({ received: true });
    },
  );
};

export default webhookRoutes;
