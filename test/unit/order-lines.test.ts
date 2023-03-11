import { describe, expect, it } from 'vitest';
import type { Product } from '../../src/db/schema.js';
import { buildOrderLines } from '../../src/services/order-service.js';

function product(overrides: Partial<Product>): Product {
  return {
    id: '00000000-0000-4000-8000-000000000000',
    sku: 'SKU',
    name: 'Thing',
    priceCents: 1000,
    currency: 'usd',
    stock: 10,
    createdAt: new Date(),
    ...overrides,
  };
}

const a = product({ id: 'aaaaaaaa-0000-4000-8000-000000000000', sku: 'A', priceCents: 1250 });
const b = product({ id: 'bbbbbbbb-0000-4000-8000-000000000000', sku: 'B', priceCents: 300 });

describe('buildOrderLines', () => {
  it('computes the total from current product prices', () => {
    const result = buildOrderLines(
      [a, b],
      [
        { productId: a.id, quantity: 2 },
        { productId: b.id, quantity: 3 },
      ],
    );
    expect(result.totalCents).toBe(2 * 1250 + 3 * 300);
    expect(result.currency).toBe('usd');
  });

  it('merges repeated products into one line', () => {
    const { lines } = buildOrderLines(
      [a],
      [
        { productId: a.id, quantity: 1 },
        { productId: a.id, quantity: 4 },
      ],
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity).toBe(5);
  });

  it('returns lines sorted by product id regardless of input order', () => {
    const { lines } = buildOrderLines(
      [a, b],
      [
        { productId: b.id, quantity: 1 },
        { productId: a.id, quantity: 1 },
      ],
    );
    expect(lines.map((l) => l.sku)).toEqual(['A', 'B']);
  });

  it('rejects unknown products', () => {
    expect(() => buildOrderLines([a], [{ productId: b.id, quantity: 1 }])).toThrowError(
      expect.objectContaining({ code: 'unknown_product' }),
    );
  });

  it('rejects mixing currencies', () => {
    const eur = product({ id: 'cccccccc-0000-4000-8000-000000000000', currency: 'eur' });
    expect(() =>
      buildOrderLines(
        [a, eur],
        [
          { productId: a.id, quantity: 1 },
          { productId: eur.id, quantity: 1 },
        ],
      ),
    ).toThrowError(expect.objectContaining({ code: 'mixed_currency' }));
  });
});
