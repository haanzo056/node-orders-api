import { describe, expect, it } from 'vitest';
import { formatMoney } from '../../src/lib/money.js';

describe('formatMoney', () => {
  it('formats cents as a currency amount', () => {
    expect(formatMoney(123456, 'usd')).toBe('$1,234.56');
    expect(formatMoney(5, 'usd')).toBe('$0.05');
  });

  it('accepts lowercase ISO codes', () => {
    expect(formatMoney(1000, 'eur', 'de-DE')).toBe('10,00 €');
  });
});
