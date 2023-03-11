import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createOrderBody,
  decodeCursor,
  encodeCursor,
  listOrdersQuery,
  orderListSchema,
  orderParams,
  orderSchema,
  toOrderDto,
} from '../schemas/orders.js';
import type { OrderService } from '../services/order-service.js';

const security = [{ bearerAuth: [] }];

const orderRoutes: FastifyPluginAsyncZod<{ orders: OrderService }> = async (app, { orders }) => {
  app.addHook('onRequest', app.authenticate);

  app.post(
    '/orders',
    {
      config: { idempotent: true, rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['orders'],
        security,
        headers: z.object({ 'idempotency-key': z.string().min(1).max(255) }).passthrough(),
        body: createOrderBody,
        response: { 201: orderSchema },
      },
    },
    async (req, reply) => {
      const order = await orders.create({ id: req.user.sub, email: req.user.email }, req.body);
      return reply.code(201).send(toOrderDto(order));
    },
  );

  app.get(
    '/orders',
    {
      schema: {
        tags: ['orders'],
        security,
        querystring: listOrdersQuery,
        response: { 200: orderListSchema },
      },
    },
    async (req) => {
      const { limit, cursor } = req.query;
      const page = await orders.list(req.user.sub, {
        limit,
        cursor: cursor ? decodeCursor(cursor) : undefined,
      });
      return {
        data: page.orders.map(toOrderDto),
        nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
      };
    },
  );

  app.get(
    '/orders/:id',
    {
      schema: { tags: ['orders'], security, params: orderParams, response: { 200: orderSchema } },
    },
    async (req) => toOrderDto(await orders.get(req.user.sub, req.params.id)),
  );

  app.post(
    '/orders/:id/cancel',
    {
      schema: { tags: ['orders'], security, params: orderParams, response: { 200: orderSchema } },
    },
    async (req) => toOrderDto(await orders.cancel(req.user.sub, req.params.id)),
  );
};

export default orderRoutes;
