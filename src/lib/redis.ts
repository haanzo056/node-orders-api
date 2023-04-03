import { Redis, type RedisOptions } from 'ioredis';

export function createRedis(url: string, opts: RedisOptions = {}) {
  return new Redis(url, { lazyConnect: false, ...opts });
}
