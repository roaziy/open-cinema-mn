import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attemptSignature, getAttempt, setAttemptBooking } from '../src/lib/checkout-store.ts';

test('same holds in any order give the same attempt and idempotency key', () => {
  let n = 0;
  const make = () => `key-${++n}`;
  const a = getAttempt(attemptSignature('s1', ['h2', 'h1']), make);
  const b = getAttempt(attemptSignature('s1', ['h1', 'h2']), make);
  assert.equal(a.key, b.key);
  assert.equal(n, 1);
});

test('different holds or showtime get a fresh key', () => {
  let n = 0;
  const make = () => `key-${++n}`;
  const a = getAttempt(attemptSignature('s2', ['h1']), make);
  const b = getAttempt(attemptSignature('s2', ['h1', 'h3']), make);
  const c = getAttempt(attemptSignature('s3', ['h1']), make);
  assert.equal(new Set([a.key, b.key, c.key]).size, 3);
});

test('the booking made for an attempt is remembered for re-entry', () => {
  const sig = attemptSignature('s4', ['h1']);
  assert.equal(getAttempt(sig, () => 'k').bookingId, null);
  setAttemptBooking(sig, 'booking-1');
  assert.equal(getAttempt(sig, () => 'other').bookingId, 'booking-1');
});
