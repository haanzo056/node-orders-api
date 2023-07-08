import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { TestProject } from 'vitest/node';
import { createDb } from '../../src/db/client.js';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

let container: StartedPostgreSqlContainer | undefined;

// Locally a throwaway Postgres is started with testcontainers (needs Docker).
// CI already has a postgres service, so it passes TEST_DATABASE_URL instead.
export async function setup(project: TestProject) {
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    url = container.getConnectionUri();
  }

  const { db, pool } = createDb(url);
  try {
    await migrate(db, { migrationsFolder: './drizzle' });
  } finally {
    await pool.end();
  }

  project.provide('databaseUrl', url);
}

export async function teardown() {
  await container?.stop();
}
