import { Worker } from 'bullmq';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { processPaymentWebhook } from './jobs/process-payment-webhook.js';
import {
  createJobQueue,
  QUEUES,
  type OrderConfirmationJob,
  type PaymentWebhookJob,
} from './jobs/queues.js';
import { sendOrderConfirmation } from './jobs/send-order-confirmation.js';
import { createMailer } from './lib/mailer.js';
import { createRedis } from './lib/redis.js';
import { createLogger } from './logger.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV === 'development');
const { db, pool } = createDb(config.DATABASE_URL, {
  max: config.DB_POOL_MAX,
  statementTimeoutMs: config.DB_STATEMENT_TIMEOUT_MS,
});
// BullMQ requires maxRetriesPerRequest: null for the blocking connections workers use
const connection = createRedis(config.REDIS_URL, { maxRetriesPerRequest: null });
const mailer = createMailer(config.SMTP_URL, config.MAIL_FROM);
const queue = createJobQueue(connection);

const emailWorker = new Worker<OrderConfirmationJob>(
  QUEUES.emails,
  (job) =>
    sendOrderConfirmation(job.data.orderId, {
      db,
      mailer,
      logger: logger.child({ queue: QUEUES.emails, jobId: job.id }),
    }),
  { connection, concurrency: 5 },
);

const webhookWorker = new Worker<PaymentWebhookJob>(
  QUEUES.paymentWebhooks,
  (job) =>
    processPaymentWebhook(job.data.eventId, {
      db,
      queue,
      logger: logger.child({ queue: QUEUES.paymentWebhooks, jobId: job.id }),
    }),
  { connection, concurrency: 10 },
);

for (const worker of [emailWorker, webhookWorker]) {
  worker.on('failed', (job, err) => {
    logger.error(
      { err, queue: worker.name, jobId: job?.id, attempts: job?.attemptsMade },
      'job failed',
    );
  });
}

logger.info('worker started');

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'worker shutting down');

  const force = setTimeout(() => {
    // jobs still running get picked up again by another worker once their lock expires
    logger.error('worker shutdown timed out, exiting');
    process.exit(1);
  }, config.SHUTDOWN_TIMEOUT_MS);
  force.unref();

  try {
    // close() stops fetching new jobs and waits for the active ones to finish
    await Promise.all([emailWorker.close(), webhookWorker.close()]);
    await queue.close();
    mailer.close();
    await Promise.all([pool.end(), connection.quit()]);
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'error during worker shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
