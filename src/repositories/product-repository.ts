import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { products } from '../db/schema.js';

export function listProducts(db: Executor, limit = 100) {
  return db.select().from(products).orderBy(asc(products.name)).limit(limit);
}

export function findProductsByIds(db: Executor, ids: string[]) {
  if (ids.length === 0) return Promise.resolve([]);
  return db.select().from(products).where(inArray(products.id, ids));
}

export async function decrementStock(db: Executor, productId: string, quantity: number) {
  const rows = await db
    .update(products)
    .set({ stock: sql`${products.stock} - ${quantity}` })
    .where(and(eq(products.id, productId), gte(products.stock, quantity)))
    .returning({ id: products.id });
  return rows.length === 1;
}

export async function incrementStock(db: Executor, productId: string, quantity: number) {
  await db
    .update(products)
    .set({ stock: sql`${products.stock} + ${quantity}` })
    .where(eq(products.id, productId));
}
