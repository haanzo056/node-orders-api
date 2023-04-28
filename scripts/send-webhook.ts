// Sends a signed fake payment event to the local API.
// Usage: npm run webhook -- <orderId> <amountCents> [eventType]
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { signPayload } from '../src/lib/webhook-signature.js';

const config = loadConfig();
const [orderId, amount, type = 'payment_intent.succeeded'] = process.argv.slice(2);
if (!orderId || !amount) {
  console.error('usage: npm run webhook -- <orderId> <amountCents> [eventType]');
  process.exit(1);
}

const event = {
  id: `evt_${randomBytes(12).toString('hex')}`,
  type,
  created: Math.floor(Date.now() / 1000),
  data: {
    object: {
      id: `pi_${randomBytes(12).toString('hex')}`,
      amount: Number(amount),
      currency: 'usd',
      metadata: { order_id: orderId },
    },
  },
};

const body = JSON.stringify(event);
const res = await fetch(`http://localhost:${config.PORT}/webhooks/payments`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'stripe-signature': signPayload(body, config.WEBHOOK_SECRET),
  },
  body,
});

console.log(event.id, res.status, await res.text());
