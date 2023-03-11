import { z } from 'zod';
import { orderStatus, type OrderWithItems } from '../db/schema.js';
import { AppError } from '../lib/errors.js';

export const createOrderBody = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1).max(100),
      }),
    )
    .min(1)
    .max(50),
});

export type CreateOrderInput = z.infer<typeof createOrderBody>;

export const orderParams = z.object({ id: z.string().uuid() });

export const listOrdersQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

const orderItemSchema = z.object({
  productId: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  quantity: z.number().int(),
  unitPriceCents: z.number().int(),
});

export const orderSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(orderStatus.enumValues),
  email: z.string(),
  currency: z.string(),
  totalCents: z.number().int(),
  items: z.array(orderItemSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const orderListSchema = z.object({
  data: z.array(orderSchema),
  nextCursor: z.string().nullable(),
});

export type OrderDto = z.infer<typeof orderSchema>;

export function toOrderDto(order: OrderWithItems): OrderDto {
  return {
    id: order.id,
    status: order.status,
    email: order.email,
    currency: order.currency,
    totalCents: order.totalCents,
    items: order.items.map((i) => ({
      productId: i.productId,
      sku: i.sku,
      name: i.name,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
    })),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

export interface OrderCursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(c: OrderCursor): string {
  return Buffer.from(`${c.createdAt.toISOString()}|${c.id}`).toString('base64url');
}

export function decodeCursor(raw: string): OrderCursor {
  const [ts, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(ts ?? '');
  if (!id || Number.isNaN(createdAt.getTime())) {
    throw new AppError(400, 'invalid_cursor', 'Malformed pagination cursor');
  }
  return { createdAt, id };
}
