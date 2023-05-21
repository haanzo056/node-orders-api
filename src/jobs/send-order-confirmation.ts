import type { Logger } from 'pino';
import type { Db } from '../db/client.js';
import type { OrderWithItems } from '../db/schema.js';
import type { Mailer } from '../lib/mailer.js';
import { formatMoney } from '../lib/money.js';
import { findOrderById, markConfirmationSent } from '../repositories/order-repository.js';

interface Deps {
  db: Db;
  mailer: Mailer;
  logger: Logger;
}

export function renderConfirmationEmail(order: OrderWithItems) {
  const lines = order.items.map(
    (i) =>
      `  ${i.quantity} x ${i.name} (${i.sku})  ${formatMoney(i.unitPriceCents * i.quantity, order.currency)}`,
  );
  const text = [
    'Thanks for your order!',
    '',
    `Order ${order.id}`,
    ...lines,
    '',
    `Total: ${formatMoney(order.totalCents, order.currency)}`,
  ].join('\n');

  return { subject: `Order confirmed (#${order.id.slice(0, 8)})`, text };
}

export async function sendOrderConfirmation(orderId: string, { db, mailer, logger }: Deps) {
  const order = await findOrderById(db, orderId);
  if (!order) {
    logger.warn({ orderId }, 'order not found, dropping confirmation');
    return;
  }
  if (order.confirmationSentAt) {
    logger.debug({ orderId }, 'confirmation already sent');
    return;
  }

  const { subject, text } = renderConfirmationEmail(order);
  await mailer.send({ to: order.email, subject, text });

  // Crashing between send and this update means a duplicate email on retry. Acceptable
  // for a confirmation email.
  await markConfirmationSent(db, orderId);
  logger.info({ orderId }, 'order confirmation sent');
}
