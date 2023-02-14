import { createDb } from '../src/db/client.js';
import { products } from '../src/db/schema.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

const { db, pool } = createDb(url);

const rows = [
  { sku: 'MUG-001', name: 'Enamel mug', priceCents: 1800, stock: 120 },
  { sku: 'TEE-BLK-M', name: 'Black t-shirt, M', priceCents: 2500, stock: 40 },
  { sku: 'TEE-BLK-L', name: 'Black t-shirt, L', priceCents: 2500, stock: 35 },
  { sku: 'CAP-OLV', name: 'Olive cap', priceCents: 2200, stock: 15 },
  { sku: 'STK-PACK', name: 'Sticker pack', priceCents: 600, stock: 500 },
  { sku: 'BAG-TOTE', name: 'Canvas tote', priceCents: 1400, stock: 0 },
];

const inserted = await db
  .insert(products)
  .values(rows)
  .onConflictDoNothing({ target: products.sku })
  .returning({ id: products.id, sku: products.sku });

console.log(`inserted ${inserted.length} products`);
for (const p of inserted) console.log(`  ${p.sku}  ${p.id}`);

await pool.end();
