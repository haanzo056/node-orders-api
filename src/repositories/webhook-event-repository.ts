import { eq } from 'drizzle-orm';
import type { Executor } from '../db/client.js';
import { webhookEvents } from '../db/schema.js';

export async function insertEvent(
  db: Executor,
  event: { id: string; type: string; payload: unknown },
): Promise<boolean> {
  const rows = await db
    .insert(webhookEvents)
    .values(event)
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  return rows.length > 0;
}

export async function lockEvent(db: Executor, id: string) {
  const [row] = await db.select().from(webhookEvents).where(eq(webhookEvents.id, id)).for('update');
  return row ?? null;
}

export async function markEventProcessed(db: Executor, id: string) {
  await db.update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.id, id));
}
