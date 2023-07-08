import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { inject } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createDb, type Db } from '../../src/db/client.js';
import { products, type Product } from '../../src/db/schema.js';
import type { JobQueue } from '../../src/jobs/queues.js';

export class RecordingQueue implements JobQueue {
  confirmations: string[] = [];
  webhooks: string[] = [];

  async enqueueOrderConfirmation(orderId: string) {
    this.confirmations.push(orderId);
  }
  async enqueuePaymentWebhook(eventId: string) {
    this.webhooks.push(eventId);
  }
  async close() {}

  reset() {
    this.confirmations = [];
    this.webhooks = [];
  }
}

export const testConfig = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: inject('databaseUrl'),
  REDIS_URL: 'redis://not-used-in-tests:6379',
  JWT_SECRET: 'integration-test-secret-that-is-long-enough',
  WEBHOOK_SECRET: 'whsec_integration_test',
  RATE_LIMIT_MAX: '10000',
});

export async function createTestContext() {
  const { db, pool } = createDb(testConfig.DATABASE_URL);
  const queue = new RecordingQueue();
  const lifecycle = { shuttingDown: false };
  const app = await buildApp({ config: testConfig, db, queue, lifecycle });
  await app.ready();

  return {
    app,
    db,
    queue,
    lifecycle,
    async close() {
      await app.close();
      await pool.end();
    },
  };
}

export type TestContext = Awaited<ReturnType<typeof createTestContext>>;

export function authHeader(ctx: TestContext, user?: { sub?: string; email?: string }) {
  const token = ctx.app.jwt.sign({
    sub: user?.sub ?? randomUUID(),
    email: user?.email ?? 'buyer@example.com',
  });
  return { authorization: `Bearer ${token}` };
}

export async function resetDb(db: Db) {
  await db.execute(
    sql`truncate order_items, orders, products, idempotency_keys, webhook_events cascade`,
  );
}

export async function createProduct(db: Db, overrides: Partial<typeof products.$inferInsert> = {}) {
  const [row] = await db
    .insert(products)
    .values({
      sku: `SKU-${randomUUID().slice(0, 8)}`,
      name: 'Test product',
      priceCents: 1500,
      stock: 10,
      ...overrides,
    })
    .returning();
  return row as Product;
}
