import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTransient, retryTransient } from '../src/lib/retry.ts';

const err = (status: number) => Object.assign(new Error('x'), { status });
const noSleep = async () => {};

test('429 is retried with backoff, then succeeds', async () => {
  const waits: number[] = [];
  let calls = 0;
  const out = await retryTransient(
    async () => {
      if (++calls < 3) throw err(429);
      return 'ok';
    },
    [10, 20, 40],
    async (ms) => {
      waits.push(ms);
    },
  );
  assert.equal(out, 'ok');
  assert.equal(calls, 3);
  assert.deepEqual(waits, [10, 20]);
});

test('gives up with the last error after the delays run out', async () => {
  let calls = 0;
  await assert.rejects(
    retryTransient(
      async () => {
        calls++;
        throw err(429);
      },
      [1, 1],
      noSleep,
    ),
    (e: { status: number }) => e.status === 429,
  );
  assert.equal(calls, 3);
});

test('401 is not transient and is thrown at once', async () => {
  let calls = 0;
  await assert.rejects(
    retryTransient(
      async () => {
        calls++;
        throw err(401);
      },
      [1, 1],
      noSleep,
    ),
  );
  assert.equal(calls, 1);
  assert.equal(isTransient(err(401)), false);
  assert.equal(isTransient(err(503)), true);
});
