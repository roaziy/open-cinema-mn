import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runRefresh } from '../src/lib/retry.ts';

const err = (status: number) => Object.assign(new Error('x'), { status });
const noSleep = async () => {};

function harness(call: () => Promise<string>, stale = () => false) {
  const log: string[] = [];
  const run = () =>
    runRefresh({
      call,
      isStale: stale,
      apply: async (t) => {
        log.push(`apply:${t}`);
      },
      clear: async () => {
        log.push('clear');
      },
      sleep: noSleep,
      delays: [1, 1],
    });
  return { log, run };
}

test('429 keeps the session: retried, then the new tokens are applied', async () => {
  let calls = 0;
  const h = harness(async () => {
    if (++calls < 3) throw err(429);
    return 'fresh';
  });
  assert.equal(await h.run(), true);
  assert.deepEqual(h.log, ['apply:fresh']);
});

test('429 that never clears: throws, session untouched (no clear)', async () => {
  const h = harness(async () => {
    throw err(429);
  });
  await assert.rejects(h.run(), (e: { status: number }) => e.status === 429);
  assert.deepEqual(h.log, []);
});

test('502 is not replayed (the token may already be rotated) and keeps the session', async () => {
  let calls = 0;
  const h = harness(async () => {
    calls++;
    throw err(502);
  });
  await assert.rejects(h.run());
  assert.equal(calls, 1);
  assert.deepEqual(h.log, []);
});

test('401 ends the session', async () => {
  const h = harness(async () => {
    throw err(401);
  });
  assert.equal(await h.run(), false);
  assert.deepEqual(h.log, ['clear']);
});

test('a result that arrives after logout is dropped', async () => {
  const h = harness(
    async () => 'late',
    () => true,
  );
  assert.equal(await h.run(), false);
  assert.deepEqual(h.log, []);
});

test('logout during the 429 backoff: the revoked token is never sent again', async () => {
  let calls = 0;
  let loggedOut = false;
  const log: string[] = [];
  await assert.rejects(
    runRefresh({
      call: async () => {
        calls++;
        throw err(429);
      },
      isStale: () => loggedOut,
      apply: async () => {
        log.push('apply');
      },
      clear: async () => {
        log.push('clear');
      },
      sleep: async () => {
        loggedOut = true;
      },
      delays: [1, 1],
    }),
    (e: { status: number }) => e.status === 429,
  );
  assert.equal(calls, 1);
  assert.deepEqual(log, []);
});
