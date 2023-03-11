// FIXME: assumes two-decimal currencies. Fine while everything is usd/eur, wrong for jpy.
export function formatMoney(cents: number, currency: string, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}
