import { describe, expect, it } from 'vitest';
import { signPayload, verifySignature } from '../../src/lib/webhook-signature.js';

const secret = 'whsec_test_secret_value';
const body = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded' });
const now = 1_700_000_000;

describe('verifySignature', () => {
  it('accepts a payload signed with the same secret', () => {
    const header = signPayload(body, secret, now);
    expect(verifySignature(body, header, secret, { now })).toBe(true);
    expect(verifySignature(Buffer.from(body), header, secret, { now })).toBe(true);
  });

  it('rejects a modified body', () => {
    const header = signPayload(body, secret, now);
    expect(verifySignature(body.replace('evt_1', 'evt_2'), header, secret, { now })).toBe(false);
  });

  it('rejects a different secret', () => {
    const header = signPayload(body, 'whsec_other_secret', now);
    expect(verifySignature(body, header, secret, { now })).toBe(false);
  });

  it('rejects timestamps outside the tolerance window', () => {
    const header = signPayload(body, secret, now - 301);
    expect(verifySignature(body, header, secret, { now })).toBe(false);
    expect(verifySignature(body, header, secret, { now, toleranceSec: 600 })).toBe(true);
  });

  it('accepts when any of several v1 signatures matches', () => {
    const good = signPayload(body, secret, now).split(',')[1];
    const header = `t=${now},v1=${'ab'.repeat(32)},${good}`;
    expect(verifySignature(body, header, secret, { now })).toBe(true);
  });

  it.each(['', 'garbage', `t=${now}`, 'v1=abcd', `t=abc,v1=${'00'.repeat(32)}`, `t=${now},v1=zz`])(
    'rejects malformed header %j',
    (header) => {
      expect(verifySignature(body, header, secret, { now })).toBe(false);
    },
  );
});
