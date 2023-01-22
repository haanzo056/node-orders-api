import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { drizzle, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema.js';

export interface DbOptions {
  max?: number;
  statementTimeoutMs?: number;
}

export function createDb(
  connectionString: string,
  { max = 10, statementTimeoutMs }: DbOptions = {},
) {
  const pool = new pg.Pool({
    connectionString,
    max,
    statement_timeout: statementTimeoutMs,
    // pg's default is to wait forever for a free connection
    connectionTimeoutMillis: 5_000,
  });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export type Db = ReturnType<typeof createDb>['db'];

// Common supertype of the db handle and a transaction, so repositories can take either.
export type Executor = PgDatabase<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
