import type { Logger } from 'pino';
import type { Executor } from '../db/client.js';
import { findOrderById, markOrderPaid } from '../repositories/order-repository.js';
import type { PaymentEvent } from '../schemas/webhooks.js';

export async function applyPaymentEvent(
  db: Executor,
  event: PaymentEvent,
  logger: Logger,
): Promise<void> {
  const intent = event.data.object;
  const orderId = intent.metadata.order_id;
  const log = logger.child({ type: event.type, orderId });

  if (!orderId) {
    log.warn('payment event without order_id metadata');
    return;
  }

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const order = await findOrderById(db, orderId);
      if (!order) {
        log.warn('payment for unknown order');
        return;
      }
      if (intent.amount !== order.totalCents) {
        // FIXME: this should land somewhere a human looks at, not just the logs
        log.error({ amount: intent.amount, expected: order.totalCents }, 'amount mismatch');
        return;
      }

      const paid = await markOrderPaid(db, orderId, intent.id);
      if (paid) {
        log.info('order paid');
      } else if (order.status === 'cancelled') {
        // TODO: trigger a refund. Until then this needs manual handling.
        log.error('payment succeeded for a cancelled order');
      }
      return;
    }

    case 'payment_intent.payment_failed':
      // order stays pending_payment so the customer can retry with another card
      log.info('payment failed');
      return;
  }
}
