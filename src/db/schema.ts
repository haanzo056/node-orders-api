import { relations, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// precision 3 so created_at round-trips through a JS Date unchanged; the order list
// cursor depends on that (microseconds would get truncated and rows skipped)
const timestamptz = (name: string) => timestamp(name, { withTimezone: true, precision: 3 });

export const orderStatus = pgEnum('order_status', ['pending_payment', 'paid', 'cancelled']);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sku: text('sku').notNull().unique(),
    name: text('name').notNull(),
    priceCents: integer('price_cents').notNull(),
    currency: text('currency').notNull().default('usd'),
    stock: integer('stock').notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    check('products_stock_non_negative', sql`${t.stock} >= 0`),
    check('products_price_positive', sql`${t.priceCents} > 0`),
  ],
);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    email: text('email').notNull(),
    status: orderStatus('status').notNull().default('pending_payment'),
    currency: text('currency').notNull(),
    totalCents: integer('total_cents').notNull(),
    paymentIntentId: text('payment_intent_id').unique(),
    confirmationSentAt: timestamptz('confirmation_sent_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [index('orders_user_created_idx').on(t.userId, t.createdAt.desc(), t.id.desc())],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
  },
  (t) => [index('order_items_order_idx').on(t.orderId)],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    userId: uuid('user_id').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    // null while the original request is still running
    statusCode: integer('status_code'),
    responseBody: jsonb('response_body'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

// Every payment event we accepted, keyed by the provider's event id. Providers deliver
// at-least-once, so this is what makes redelivery a no-op.
export const webhookEvents = pgTable('webhook_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  payload: jsonb('payload').notNull(),
  receivedAt: timestamptz('received_at').notNull().defaultNow(),
  processedAt: timestamptz('processed_at'),
});

export const ordersRelations = relations(orders, ({ many }) => ({
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  product: one(products, { fields: [orderItems.productId], references: [products.id] }),
}));

export type Product = typeof products.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type OrderWithItems = Order & { items: OrderItem[] };
