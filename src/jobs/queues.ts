import { Queue, type DefaultJobOptions } from 'bullmq';
import type { Redis } from 'ioredis';

export const QUEUES = {
  emails: 'emails',
  paymentWebhooks: 'payment-webhooks',
} as const;

export interface OrderConfirmationJob {
  orderId: string;
}

export interface PaymentWebhookJob {
  eventId: string;
}

export interface JobQueue {
  enqueueOrderConfirmation(orderId: string): Promise<void>;
  enqueuePaymentWebhook(eventId: string): Promise<void>;
  close(): Promise<void>;
}

// 8 attempts with exponential backoff from 5s is roughly 10 minutes of retrying,
// enough to ride out an SMTP or DB blip. After that the job sits in the failed set.
const defaultJobOptions: DefaultJobOptions = {
  attempts: 8,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 5_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

export function createJobQueue(connection: Redis): JobQueue {
  const emails = new Queue<OrderConfirmationJob>(QUEUES.emails, {
    connection,
    defaultJobOptions,
  });
  const paymentWebhooks = new Queue<PaymentWebhookJob>(QUEUES.paymentWebhooks, {
    connection,
    defaultJobOptions,
  });

  return {
    async enqueueOrderConfirmation(orderId) {
      // jobId dedupes while the job still exists in redis; the job itself also checks
      // confirmation_sent_at, which covers the case where it was already removed
      await emails.add('order-confirmation', { orderId }, { jobId: `confirm-${orderId}` });
    },
    async enqueuePaymentWebhook(eventId) {
      await paymentWebhooks.add('process', { eventId }, { jobId: `webhook-${eventId}` });
    },
    async close() {
      await Promise.all([emails.close(), paymentWebhooks.close()]);
    },
  };
}
