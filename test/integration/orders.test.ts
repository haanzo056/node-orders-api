import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { orders, products } from '../../src/db/schema.js';
import {
  authHeader,
  createProduct,
  createTestContext,
  resetDb,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  await resetDb(ctx.db);
});

async function stockOf(id: string) {
  const [row] = await ctx.db.select().from(products).where(eq(products.id, id));
  return row?.stock;
}

function postOrder(
  headers: Record<string, string>,
  items: { productId: string; quantity: number }[],
  key: string = randomUUID(),
) {
  return ctx.app.inject({
    method: 'POST',
    url: '/orders',
    headers: { ...headers, 'idempotency-key': key },
    payload: { items },
  });
}

describe('POST /orders', () => {
  it('requires a token', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/orders', payload: { items: [] } });
    expect(res.statusCode).toBe(401);
  });

  it('creates an order and reserves stock', async () => {
    const mug = await createProduct(ctx.db, { priceCents: 1800, stock: 5 });
    const tee = await createProduct(ctx.db, { priceCents: 2500, stock: 5 });

    const res = await postOrder(authHeader(ctx), [
      { productId: mug.id, quantity: 2 },
      { productId: tee.id, quantity: 1 },
    ]);

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('pending_payment');
    expect(body.totalCents).toBe(2 * 1800 + 2500);
    expect(body.items).toHaveLength(2);
    expect(await stockOf(mug.id)).toBe(3);
    expect(await stockOf(tee.id)).toBe(4);
  });

  it('rolls back everything when one item is out of stock', async () => {
    const plenty = await createProduct(ctx.db, { stock: 10 });
    const scarce = await createProduct(ctx.db, { stock: 1 });

    const res = await postOrder(authHeader(ctx), [
      { productId: plenty.id, quantity: 3 },
      { productId: scarce.id, quantity: 2 },
    ]);

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('insufficient_stock');
    expect(await stockOf(plenty.id)).toBe(10);
    expect(await ctx.db.select().from(orders)).toHaveLength(0);
  });

  it('validates the body', async () => {
    const res = await postOrder(authHeader(ctx), [{ productId: 'nope', quantity: 0 }]);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_failed');
  });

  it('rejects requests without an idempotency key', async () => {
    const p = await createProduct(ctx.db);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/orders',
      headers: authHeader(ctx),
      payload: { items: [{ productId: p.id, quantity: 1 }] },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('idempotency', () => {
  it('replays the original response for a retried request', async () => {
    const p = await createProduct(ctx.db, { stock: 10 });
    const headers = authHeader(ctx);
    const key = randomUUID();
    const items = [{ productId: p.id, quantity: 2 }];

    const first = await postOrder(headers, items, key);
    const second = await postOrder(headers, items, key);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json().id).toBe(first.json().id);
    expect(await ctx.db.select().from(orders)).toHaveLength(1);
    expect(await stockOf(p.id)).toBe(8);
  });

  it('refuses to reuse a key for a different body', async () => {
    const p = await createProduct(ctx.db);
    const headers = authHeader(ctx);
    const key = randomUUID();

    await postOrder(headers, [{ productId: p.id, quantity: 1 }], key);
    const res = await postOrder(headers, [{ productId: p.id, quantity: 2 }], key);

    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('idempotency_key_reused');
  });

  it('scopes keys to the user', async () => {
    const p = await createProduct(ctx.db);
    const key = randomUUID();
    const items = [{ productId: p.id, quantity: 1 }];

    const a = await postOrder(authHeader(ctx), items, key);
    const b = await postOrder(authHeader(ctx), items, key);

    expect(b.statusCode).toBe(201);
    expect(b.json().id).not.toBe(a.json().id);
  });
});

describe('GET /orders', () => {
  it('does not expose other users orders', async () => {
    const p = await createProduct(ctx.db);
    const created = await postOrder(authHeader(ctx), [{ productId: p.id, quantity: 1 }]);

    const res = await ctx.app.inject({
      method: 'GET',
      url: `/orders/${created.json().id}`,
      headers: authHeader(ctx),
    });
    expect(res.statusCode).toBe(404);
  });

  it('pages through all orders with a cursor without gaps or repeats', async () => {
    const p = await createProduct(ctx.db, { stock: 100 });
    const headers = authHeader(ctx, { sub: randomUUID() });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await postOrder(headers, [{ productId: p.id, quantity: 1 }]);
      ids.push(res.json().id);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = cursor ? `/orders?limit=2&cursor=${cursor}` : '/orders?limit=2';
      const res = await ctx.app.inject({ method: 'GET', url, headers });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      seen.push(...body.data.map((o: { id: string }) => o.id));
      cursor = body.nextCursor;
      pages++;
    } while (cursor && pages < 10);

    expect(pages).toBe(3);
    expect(seen).toHaveLength(5);
    expect(new Set(seen)).toEqual(new Set(ids));
  });

  it('rejects a garbage cursor', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/orders?cursor=bm9wZQ',
      headers: authHeader(ctx),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /orders/:id/cancel', () => {
  it('cancels a pending order only once', async () => {
    const p = await createProduct(ctx.db);
    const headers = authHeader(ctx, { sub: randomUUID() });
    const created = await postOrder(headers, [{ productId: p.id, quantity: 1 }]);
    const url = `/orders/${created.json().id}/cancel`;

    const first = await ctx.app.inject({ method: 'POST', url, headers });
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe('cancelled');

    const second = await ctx.app.inject({ method: 'POST', url, headers });
    expect(second.statusCode).toBe(409);
  });

  it('puts reserved stock back', async () => {
    const p = await createProduct(ctx.db, { stock: 5 });
    const headers = authHeader(ctx);
    const created = await postOrder(headers, [{ productId: p.id, quantity: 3 }]);
    expect(await stockOf(p.id)).toBe(2);

    await ctx.app.inject({ method: 'POST', url: `/orders/${created.json().id}/cancel`, headers });
    expect(await stockOf(p.id)).toBe(5);
  });
});
