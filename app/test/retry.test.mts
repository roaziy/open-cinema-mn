import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isRateLimited, isTransient, MAX_WAIT_MS, retryTransient } from '../src/lib/retry.ts';

const err = (status: number, retryAfter?: number) =>
  Object.assign(new Error('x'), { status, retryAfter });
const noSleep = async () => {};

test('429 is retried with backoff, then succeeds', async () => {
  const waits: number[] = [];
  let calls = 0;
  const out = await retryTransient(
    async () => {
      if (++calls < 3) throw err(429);
      return 'ok';
    },
    {
      delays: [10, 20, 40],
      sleep: async (ms) => {
        waits.push(ms);
      },
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
      { delays: [1, 1], sleep: noSleep },
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
      { delays: [1, 1], sleep: noSleep },
    ),
  );
  assert.equal(calls, 1);
  assert.equal(isTransient(err(401)), false);
  assert.equal(isTransient(err(503)), true);
  assert.equal(isRateLimited(err(503)), false);
});

test('Retry-After replaces the backoff delay but is capped', async () => {
  const waits: number[] = [];
  let calls = 0;
  await retryTransient(
    async () => {
      calls++;
      if (calls === 1) throw err(429, 3);
      if (calls === 2) throw err(429, 600);
      return 'ok';
    },
    {
      delays: [10, 10],
      sleep: async (ms) => {
        waits.push(ms);
      },
    },
  );
  assert.deepEqual(waits, [3000, MAX_WAIT_MS]);
});

test('stops retrying once the caller no longer wants the result', async () => {
  let calls = 0;
  await assert.rejects(
    retryTransient(
      async () => {
        calls++;
        throw err(429);
      },
      { delays: [1, 1], sleep: noSleep, shouldContinue: () => false },
    ),
  );
  assert.equal(calls, 1);
});
