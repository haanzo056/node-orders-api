import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { orders, webhookEvents } from '../../src/db/schema.js';
import { processPaymentWebhook } from '../../src/jobs/process-payment-webhook.js';
import { signPayload } from '../../src/lib/webhook-signature.js';
import {
  authHeader,
  createProduct,
  createTestContext,
  resetDb,
  testConfig,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
const logger = pino({ level: 'silent' });

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  await resetDb(ctx.db);
  ctx.queue.reset();
});

function paymentEvent(orderId: string, amount: number, type = 'payment_intent.succeeded') {
  return {
    id: `evt_${randomUUID().replaceAll('-', '')}`,
    type,
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: `pi_${randomUUID()}`, amount, metadata: { order_id: orderId } } },
  };
}

function deliver(event: object, signature?: string) {
  const body = JSON.stringify(event);
  return ctx.app.inject({
    method: 'POST',
    url: '/webhooks/payments',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature ?? signPayload(body, testConfig.WEBHOOK_SECRET),
    },
    payload: body,
  });
}

async function createOrder(headers = authHeader(ctx)) {
  const product = await createProduct(ctx.db, { priceCents: 2000 });
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/orders',
    headers: { ...headers, 'idempotency-key': randomUUID() },
    payload: { items: [{ productId: product.id, quantity: 2 }] },
  });
  return res.json() as { id: string; totalCents: number };
}

async function orderRow(id: string) {
  const [row] = await ctx.db.select().from(orders).where(eq(orders.id, id));
  return row;
}

describe('POST /webhooks/payments', () => {
  it('rejects a bad signature', async () => {
    const res = await deliver(paymentEvent(randomUUID(), 100), 't=1,v1=deadbeef');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('invalid_signature');
  });

  it('rejects a stale signature', async () => {
    const event = paymentEvent(randomUUID(), 100);
    const old = Math.floor(Date.now() / 1000) - 3600;
    const res = await deliver(
      event,
      signPayload(JSON.stringify(event), testConfig.WEBHOOK_SECRET, old),
    );
    expect(res.statusCode).toBe(400);
  });

  it('stores a redelivered event only once', async () => {
    const event = paymentEvent(randomUUID(), 100);

    expect((await deliver(event)).statusCode).toBe(200);
    expect((await deliver(event)).statusCode).toBe(200);

    const rows = await ctx.db.select().from(webhookEvents).where(eq(webhookEvents.id, event.id));
    expect(rows).toHaveLength(1);
  });

  it('acknowledges but ignores unhandled event types', async () => {
    const res = await deliver(paymentEvent(randomUUID(), 100, 'customer.created'));
    expect(res.statusCode).toBe(200);
    expect(ctx.queue.webhooks).toHaveLength(0);
  });
});

describe('processPaymentWebhook', () => {
  const deps = () => ({ db: ctx.db, queue: ctx.queue, logger });

  it('marks the order paid and queues the confirmation', async () => {
    const order = await createOrder();
    const event = paymentEvent(order.id, order.totalCents);
    await deliver(event);

    await processPaymentWebhook(event.id, deps());

    expect((await orderRow(order.id))?.status).toBe('paid');
    expect(ctx.queue.confirmations).toEqual([order.id]);
    const [stored] = await ctx.db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.id, event.id));
    expect(stored?.processedAt).toBeInstanceOf(Date);
  });

  it('is safe to run twice for the same event', async () => {
    const order = await createOrder();
    const event = paymentEvent(order.id, order.totalCents);
    await deliver(event);

    await processPaymentWebhook(event.id, deps());
    await processPaymentWebhook(event.id, deps());

    expect((await orderRow(order.id))?.status).toBe('paid');
    expect(new Set(ctx.queue.confirmations)).toEqual(new Set([order.id]));
  });

  it('leaves the order pending when the amount does not match', async () => {
    const order = await createOrder();
    const event = paymentEvent(order.id, order.totalCents - 1);
    await deliver(event);

    await processPaymentWebhook(event.id, deps());

    expect((await orderRow(order.id))?.status).toBe('pending_payment');
    expect(ctx.queue.confirmations).toHaveLength(0);
  });

  it('does not resurrect a cancelled order', async () => {
    const headers = authHeader(ctx);
    const order = await createOrder(headers);
    await ctx.app.inject({ method: 'POST', url: `/orders/${order.id}/cancel`, headers });
    const event = paymentEvent(order.id, order.totalCents);
    await deliver(event);

    await processPaymentWebhook(event.id, deps());

    expect((await orderRow(order.id))?.status).toBe('cancelled');
    expect(ctx.queue.confirmations).toHaveLength(0);
  });
});
