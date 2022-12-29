import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import type { Db } from '../db/client.js';

const checkResult = z.enum(['ok', 'fail']);

const readySchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  checks: z.object({ db: checkResult, redis: checkResult.optional() }),
});

interface Options {
  db: Db;
  redis?: Redis;
  lifecycle: { shuttingDown: boolean };
}

async function probe(fn: () => Promise<unknown>, timeoutMs = 1000): Promise<'ok' | 'fail'> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
    return 'ok';
  } catch {
    return 'fail';
  } finally {
    clearTimeout(timer);
  }
}

const healthRoutes: FastifyPluginAsyncZod<Options> = async (app, { db, redis, lifecycle }) => {
  const routeConfig = { rateLimit: false as const };

  app.get(
    '/health/live',
    {
      config: routeConfig,
      logLevel: 'warn',
      schema: { tags: ['health'], response: { 200: z.object({ status: z.literal('ok') }) } },
    },
    async () => ({ status: 'ok' as const }),
  );

  app.get(
    '/health/ready',
    {
      config: routeConfig,
      logLevel: 'warn',
      schema: { tags: ['health'], response: { 200: readySchema, 503: readySchema } },
    },
    async (_req, reply) => {
      const [dbCheck, redisCheck] = await Promise.all([
        probe(() => db.execute(sql`select 1`)),
        redis ? probe(() => redis.ping()) : Promise.resolve(undefined),
      ]);

      const healthy = !lifecycle.shuttingDown && dbCheck === 'ok' && redisCheck !== 'fail';
      return reply.code(healthy ? 200 : 503).send({
        status: healthy ? 'ok' : 'unavailable',
        checks: { db: dbCheck, redis: redisCheck },
      });
    },
  );
};

export default healthRoutes;
