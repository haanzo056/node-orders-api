import { createHmac, timingSafeEqual } from 'node:crypto';

// Same scheme Stripe uses: header "t=<unix>,v1=<hex hmac>" where the HMAC-SHA256 is
// computed over "<t>.<raw body>". Kept dependency-free so we don't pull in the SDK
// just for this.

const DEFAULT_TOLERANCE_SEC = 300;

function hmac(secret: string, timestamp: number, payload: string | Buffer): Buffer {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(payload).digest();
}

export function signPayload(
  payload: string | Buffer,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
): string {
  return `t=${timestamp},v1=${hmac(secret, timestamp, payload).toString('hex')}`;
}

export function verifySignature(
  payload: string | Buffer,
  header: string,
  secret: string,
  { toleranceSec = DEFAULT_TOLERANCE_SEC, now = Math.floor(Date.now() / 1000) } = {},
): boolean {
  let timestamp: number | undefined;
  const candidates: string[] = [];

  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === 't') timestamp = Number(value);
    // there can be several v1 entries while a secret is being rotated
    else if (key === 'v1') candidates.push(value);
  }

  if (timestamp === undefined || !Number.isInteger(timestamp) || candidates.length === 0) {
    return false;
  }
  if (Math.abs(now - timestamp) > toleranceSec) return false;

  const expected = hmac(secret, timestamp, payload);
  return candidates.some((hex) => {
    const given = Buffer.from(hex, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
