import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { createJobQueue } from './jobs/queues.js';
import { createRedis } from './lib/redis.js';

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL, {
  max: config.DB_POOL_MAX,
  statementTimeoutMs: config.DB_STATEMENT_TIMEOUT_MS,
});
// fail fast: a rate-limit lookup shouldn't hang a request while redis is down
const redis = createRedis(config.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 2000 });
const queueConnection = createRedis(config.REDIS_URL, { maxRetriesPerRequest: null });
const queue = createJobQueue(queueConnection);
const lifecycle = { shuttingDown: false };

const app = await buildApp({ config, db, redis, queue, lifecycle });

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  app.log.info({ signal }, 'shutting down');

  // readiness starts failing right away so the LB stops routing to us;
  // app.close() then waits for in-flight requests
  lifecycle.shuttingDown = true;
  const force = setTimeout(() => {
    app.log.error('graceful shutdown timed out, exiting');
    process.exit(1);
  }, config.SHUTDOWN_TIMEOUT_MS);
  force.unref();

  try {
    await app.close();
    await queue.close();
    await Promise.all([pool.end(), redis.quit(), queueConnection.quit()]);
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (err) {
  app.log.fatal({ err }, 'failed to start');
  process.exit(1);
}
