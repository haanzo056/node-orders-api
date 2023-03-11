import type { Db } from '../db/client.js';
import type { OrderWithItems, Product } from '../db/schema.js';
import { AppError, notFound } from '../lib/errors.js';
import * as orderRepo from '../repositories/order-repository.js';
import * as productRepo from '../repositories/product-repository.js';
import type { CreateOrderInput, OrderCursor } from '../schemas/orders.js';

export interface OrderLine {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
}

export function buildOrderLines(products: Product[], items: CreateOrderInput['items']) {
  const quantities = new Map<string, number>();
  for (const item of items) {
    quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  }

  const byId = new Map(products.map((p) => [p.id, p]));
  const lines: OrderLine[] = [];
  let currency: string | undefined;

  for (const [productId, quantity] of quantities) {
    const product = byId.get(productId);
    if (!product) {
      throw new AppError(422, 'unknown_product', `Product ${productId} does not exist`);
    }
    currency ??= product.currency;
    if (product.currency !== currency) {
      throw new AppError(422, 'mixed_currency', 'All items in an order must share a currency');
    }
    lines.push({
      productId,
      sku: product.sku,
      name: product.name,
      quantity,
      unitPriceCents: product.priceCents,
    });
  }

  if (!currency) throw new AppError(422, 'empty_order', 'Order has no items');

  // Stock rows get locked in this order; keeping it deterministic means two concurrent
  // orders for the same products can't deadlock each other.
  lines.sort((a, b) => a.productId.localeCompare(b.productId));

  const totalCents = lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
  return { lines, currency, totalCents };
}

export class OrderService {
  constructor(private readonly db: Db) {}

  create(
    customer: { id: string; email: string },
    input: CreateOrderInput,
  ): Promise<OrderWithItems> {
    return this.db.transaction(async (tx) => {
      const ids = [...new Set(input.items.map((i) => i.productId))];
      const products = await productRepo.findProductsByIds(tx, ids);
      const { lines, currency, totalCents } = buildOrderLines(products, input.items);

      for (const line of lines) {
        const reserved = await productRepo.decrementStock(tx, line.productId, line.quantity);
        if (!reserved) {
          throw new AppError(409, 'insufficient_stock', `Not enough stock for ${line.sku}`, {
            productId: line.productId,
          });
        }
      }

      return orderRepo.insertOrder(
        tx,
        { userId: customer.id, email: customer.email, currency, totalCents },
        lines,
      );
    });
  }

  async get(userId: string, orderId: string) {
    const order = await orderRepo.findOrderForUser(this.db, userId, orderId);
    if (!order) throw notFound('Order');
    return order;
  }

  list(userId: string, opts: { limit: number; cursor?: OrderCursor }) {
    return orderRepo.listOrdersForUser(this.db, userId, opts);
  }

  cancel(userId: string, orderId: string): Promise<OrderWithItems> {
    return this.db.transaction(async (tx) => {
      const cancelled = await orderRepo.cancelPendingOrder(tx, userId, orderId);
      if (cancelled) {
        for (const item of cancelled.items) {
          await productRepo.incrementStock(tx, item.productId, item.quantity);
        }
        return cancelled;
      }

      const existing = await orderRepo.findOrderForUser(tx, userId, orderId);
      if (!existing) throw notFound('Order');
      throw new AppError(
        409,
        'invalid_order_state',
        `Order is ${existing.status} and can no longer be cancelled`,
      );
    });
  }
}
