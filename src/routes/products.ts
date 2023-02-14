import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { listProducts } from '../repositories/product-repository.js';

const productSchema = z.object({
  id: z.string().uuid(),
  sku: z.string(),
  name: z.string(),
  priceCents: z.number().int(),
  currency: z.string(),
  inStock: z.boolean(),
});

const productRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.get(
    '/products',
    {
      schema: {
        tags: ['products'],
        response: { 200: z.object({ data: z.array(productSchema) }) },
      },
    },
    async () => {
      const rows = await listProducts(db);
      return {
        data: rows.map((p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          priceCents: p.priceCents,
          currency: p.currency,
          inStock: p.stock > 0,
        })),
      };
    },
  );
};

export default productRoutes;
