# node-orders-api

Backend for the orders/checkout part of a small shop. Customers create orders against
a product catalog, pay through a Stripe-style provider, and get a confirmation email
once the payment webhook comes in.

Node 20, TypeScript, Fastify 5, Postgres (Drizzle), Redis + BullMQ.

```
src/
  routes/        HTTP layer: zod schemas, auth, status codes
  services/      business rules (stock reservation, payment state changes)
  repositories/  Drizzle queries, take either the db or a transaction
  jobs/          BullMQ queue definitions and job handlers
  plugins/       auth, idempotency, error handling, swagger
  server.ts      API entrypoint
  worker.ts      job worker entrypoint
drizzle/         SQL migrations (generated with drizzle-kit)
```

## Running it

Everything in Docker:

```sh
docker compose up --build
```

API on :3000, OpenAPI UI on http://localhost:3000/docs, Mailpit (catches outgoing
email) on http://localhost:8025. The api container runs migrations on start.

Locally, with only the infrastructure in Docker:

```sh
cp .env.example .env
docker compose up -d postgres redis mailpit
npm install
npm run db:migrate
npm run db:seed
npm run dev          # api
npm run dev:worker   # in another terminal
```

Trying the flow by hand:

```sh
TOKEN=$(npm run -s token)
curl -s localhost:3000/products
curl -s -X POST localhost:3000/orders \
  -H "authorization: Bearer $TOKEN" \
  -H "idempotency-key: $(uuidgen)" \
  -H 'content-type: application/json' \
  -d '{"items":[{"productId":"<id from /products>","quantity":2}]}'

npm run webhook -- <orderId> <totalCents>   # sends a signed payment_intent.succeeded
```

The email should show up in Mailpit a moment later.

## Tests

```sh
npm test                    # unit tests, no services needed
npm run test:integration    # needs Docker
```

Integration tests build the real app and hit it with `fastify.inject`, against a real
Postgres. Locally that Postgres is started by testcontainers in a global setup. If
`TEST_DATABASE_URL` is set, testcontainers is skipped and that database is used
instead, which is what CI does with its postgres service. Redis isn't needed: the app
takes the job queue as a dependency and the tests pass in a recording fake, and rate
limiting falls back to in-memory.

## Notes on some decisions

### Idempotency

`POST /orders` requires an `Idempotency-Key` header. Keys are stored in
Postgres per user along with a hash of the request. A retry with the same key and body
gets the stored response back (with `idempotent-replayed: true`); the same key with a
different body is a 422; a retry while the first request is still running is a 409.
4xx responses are stored like successes, 5xx responses release the key so the client
can retry. I kept this in Postgres rather than Redis so the key and the order it
produced live in the same database.

### Stock

Stock is reserved when the order is created, with a conditional
`UPDATE ... WHERE stock >= qty`, in the same transaction as the order insert. Rows are
updated in a fixed order to avoid deadlocks between concurrent orders. Cancelling a
pending order puts the stock back.

### Webhooks

The signature check follows Stripe's scheme (`t=...,v1=...`, HMAC over
`timestamp.body`, 5 minute tolerance), so switching to the official SDK later is a
small change. The handler only verifies, stores the event (keyed by provider event id)
and enqueues it; the actual work happens in the worker. Providers redeliver, so the
worker locks the event row, skips it if it's already processed, and the order update
only moves `pending_payment -> paid`.

### Jobs and retries

Both queues retry 8 times with exponential backoff starting at
5s, which covers about 10 minutes. Failed jobs are kept for a week. Handlers are
written to be safe to run more than once: the confirmation email checks
`confirmation_sent_at` first, and job ids are derived from the order/event id so
duplicates collapse while the job is still in Redis. A crash right after sending an
email but before recording it can still produce a duplicate email, which I'm fine with.

### Why Fastify and Drizzle

Fastify because schema-first routes with zod give request
validation, response serialization and the OpenAPI doc from one definition, and the
plugin encapsulation makes things like the raw-body parser for the webhook route easy
to scope. Drizzle because it stays close to SQL, the conditional updates above are
easy to express, and the migrations are plain SQL files I can read in review.

### Auth

The API doesn't issue tokens. It expects HS256 JWTs from a separate auth
service with `sub` (user uuid) and `email`. `npm run token` mints one for local use.

## Known issues / TODO

- An idempotency key whose request crashed mid-way stays "in progress" forever. Needs
  an expiry for stale in-progress rows, and a cleanup job for old keys in general.
- Unpaid orders hold stock indefinitely. Needs a sweeper that cancels orders stuck in
  `pending_payment` for more than a few hours.
- Payments that arrive for an already cancelled order are only logged; refunds are
  manual.
- Creating the PaymentIntent with the provider isn't implemented. The client is
  expected to pass the order id as `metadata.order_id`.
- Money formatting assumes two-decimal currencies.
- Rate limiting is per IP. Per-user limits for authenticated routes would be better.
