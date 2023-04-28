import { z } from 'zod';

export const paymentEventSchema = z.object({
  id: z.string().min(1),
  type: z.string(),
  created: z.number().int(),
  data: z.object({
    object: z
      .object({
        id: z.string(),
        amount: z.number().int().optional(),
        currency: z.string().optional(),
        metadata: z.record(z.string()).default({}),
      })
      .passthrough(),
  }),
});

export type PaymentEvent = z.infer<typeof paymentEventSchema>;

export const HANDLED_EVENT_TYPES = new Set([
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
]);
