import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Redis } from 'ioredis';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import type { JobQueue } from './jobs/queues.js';
import { AppError } from './lib/errors.js';
import { loggerOptions } from './logger.js';
import auth from './plugins/auth.js';
import errorHandler from './plugins/error-handler.js';
import idempotency from './plugins/idempotency.js';
import swagger from './plugins/swagger.js';
import healthRoutes from './routes/health.js';
import orderRoutes from './routes/orders.js';
import productRoutes from './routes/products.js';
import webhookRoutes from './routes/webhooks.js';
import { OrderService } from './services/order-service.js';

export interface AppDeps {
  config: Config;
  db: Db;
  // optional so tests can run without redis; rate limiting falls back to in-memory
  redis?: Redis;
  queue: JobQueue;
  lifecycle?: { shuttingDown: boolean };
}

export async function buildApp({
  config,
  db,
  redis,
  queue,
  lifecycle = { shuttingDown: false },
}: AppDeps) {
  const app = Fastify({
    logger: loggerOptions(config.LOG_LEVEL, config.NODE_ENV === 'development'),
    trustProxy: true,
    requestIdHeader: 'x-request-id',
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(errorHandler);
  // must be registered before the routes so it picks them up
  await app.register(swagger);
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    redis,
    nameSpace: 'orders-api:rl:',
    // don't take the whole API down because redis is flaky
    skipOnError: true,
    errorResponseBuilder: (_req, ctx) =>
      new AppError(429, 'rate_limited', `Too many requests, retry in ${ctx.after}`),
  });
  await app.register(auth, { secret: config.JWT_SECRET, issuer: config.JWT_ISSUER });
  await app.register(idempotency, { db });

  await app.register(healthRoutes, { db, redis, lifecycle });
  await app.register(productRoutes, { db });
  await app.register(orderRoutes, { orders: new OrderService(db) });
  await app.register(webhookRoutes, { secret: config.WEBHOOK_SECRET, db, queue });

  return app;
}
