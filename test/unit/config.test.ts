import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'x'.repeat(32),
  WEBHOOK_SECRET: 'whsec_0123456789abcdef',
};

describe('loadConfig', () => {
  it('applies defaults and coerces numbers', () => {
    const config = loadConfig({ ...base, PORT: '8080' });
    expect(config.PORT).toBe(8080);
    expect(config.NODE_ENV).toBe('development');
    expect(config.RATE_LIMIT_MAX).toBe(100);
  });

  it('lists every invalid variable in the error', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short', DATABASE_URL: undefined })).toThrow(
      /JWT_SECRET[\s\S]*DATABASE_URL|DATABASE_URL[\s\S]*JWT_SECRET/,
    );
  });
});
