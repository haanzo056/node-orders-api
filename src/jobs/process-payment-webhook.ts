import type { Logger } from 'pino';
import type { Db } from '../db/client.js';
import { findOrderById } from '../repositories/order-repository.js';
import { lockEvent, markEventProcessed } from '../repositories/webhook-event-repository.js';
import { paymentEventSchema } from '../schemas/webhooks.js';
import { applyPaymentEvent } from '../services/payment-service.js';
import type { JobQueue } from './queues.js';

interface Deps {
  db: Db;
  queue: JobQueue;
  logger: Logger;
}

export async function processPaymentWebhook(eventId: string, { db, queue, logger }: Deps) {
  const log = logger.child({ eventId });

  const event = await db.transaction(async (tx) => {
    // FOR UPDATE so two workers holding the same event (redelivery racing a retry)
    // can't both apply it
    const row = await lockEvent(tx, eventId);
    if (!row) {
      log.warn('webhook event not found');
      return null;
    }
    const parsed = paymentEventSchema.parse(row.payload);
    if (!row.processedAt) {
      await applyPaymentEvent(tx, parsed, log);
      await markEventProcessed(tx, eventId);
    }
    return parsed;
  });

  if (event?.type !== 'payment_intent.succeeded') return;
  const orderId = event.data.object.metadata.order_id;
  if (!orderId) return;

  // Deliberately checked on every run, not just the one that applied the event: if the
  // enqueue below failed last time, the retry sees processedAt set and would otherwise
  // never send the email. Duplicate enqueues are deduped by jobId.
  const order = await findOrderById(db, orderId);
  if (order?.status === 'paid' && !order.confirmationSentAt) {
    await queue.enqueueOrderConfirmation(orderId);
  }
}
