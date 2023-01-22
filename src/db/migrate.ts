import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const { db, pool } = createDb(url);
try {
  await migrate(db, { migrationsFolder: './drizzle' });
} finally {
  await pool.end();
}
