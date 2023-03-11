import { and, desc, eq, lt, or } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { orderItems, orders, type OrderWithItems } from '../db/schema.js';
import type { OrderCursor } from '../schemas/orders.js';

type NewOrder = Pick<typeof orders.$inferInsert, 'userId' | 'email' | 'currency' | 'totalCents'>;
type NewOrderItem = Omit<typeof orderItems.$inferInsert, 'id' | 'orderId'>;

export async function insertOrder(
  db: Executor,
  order: NewOrder,
  lines: NewOrderItem[],
): Promise<OrderWithItems> {
  const [created] = await db.insert(orders).values(order).returning();
  if (!created) throw new Error('order insert returned no rows');
  const items = await db
    .insert(orderItems)
    .values(lines.map((l) => ({ ...l, orderId: created.id })))
    .returning();
  return { ...created, items };
}

export async function findOrderById(db: Executor, id: string) {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    with: { items: true },
  });
  return order ?? null;
}

export async function findOrderForUser(db: Executor, userId: string, id: string) {
  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.userId, userId)),
    with: { items: true },
  });
  return order ?? null;
}

export async function listOrdersForUser(
  db: Executor,
  userId: string,
  { limit, cursor }: { limit: number; cursor?: OrderCursor },
) {
  const after = cursor
    ? or(
        lt(orders.createdAt, cursor.createdAt),
        and(eq(orders.createdAt, cursor.createdAt), lt(orders.id, cursor.id)),
      )
    : undefined;

  const rows = await db.query.orders.findMany({
    where: and(eq(orders.userId, userId), after),
    orderBy: [desc(orders.createdAt), desc(orders.id)],
    limit: limit + 1,
    with: { items: true },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  return {
    orders: page,
    nextCursor: hasMore && last ? { createdAt: last.createdAt, id: last.id } : null,
  };
}

export async function cancelPendingOrder(
  db: Executor,
  userId: string,
  id: string,
): Promise<OrderWithItems | null> {
  const [row] = await db
    .update(orders)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(eq(orders.id, id), eq(orders.userId, userId), eq(orders.status, 'pending_payment')))
    .returning();
  if (!row) return null;
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, id));
  return { ...row, items };
}

export async function markConfirmationSent(db: Executor, id: string) {
  await db.update(orders).set({ confirmationSentAt: new Date() }).where(eq(orders.id, id));
}

export async function markOrderPaid(db: Executor, id: string, paymentIntentId: string) {
  const [row] = await db
    .update(orders)
    .set({ status: 'paid', paymentIntentId, updatedAt: new Date() })
    .where(and(eq(orders.id, id), eq(orders.status, 'pending_payment')))
    .returning();
  return row ?? null;
}
