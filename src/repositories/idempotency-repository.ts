import { and, eq } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { idempotencyKeys } from '../db/schema.js';

export async function claimKey(
  db: Executor,
  row: { userId: string; key: string; requestHash: string },
): Promise<boolean> {
  const inserted = await db
    .insert(idempotencyKeys)
    .values(row)
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key });
  return inserted.length > 0;
}

export async function findKey(db: Executor, userId: string, key: string) {
  const [row] = await db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
  return row ?? null;
}

export async function completeKey(
  db: Executor,
  userId: string,
  key: string,
  statusCode: number,
  responseBody: unknown,
) {
  await db
    .update(idempotencyKeys)
    .set({ statusCode, responseBody })
    .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
}

export async function releaseKey(db: Executor, userId: string, key: string) {
  await db
    .delete(idempotencyKeys)
    .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
}
