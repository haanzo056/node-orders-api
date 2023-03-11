// Usage: npm run token -- [userId] [email]
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { loadConfig } from '../src/config.js';
import auth from '../src/plugins/auth.js';

const config = loadConfig();
const [sub = randomUUID(), email = 'dev@example.com'] = process.argv.slice(2);

const app = Fastify();
await app.register(auth, { secret: config.JWT_SECRET, issuer: config.JWT_ISSUER });
await app.ready();

console.log(app.jwt.sign({ sub, email }, { expiresIn: '12h' }));
await app.close();
