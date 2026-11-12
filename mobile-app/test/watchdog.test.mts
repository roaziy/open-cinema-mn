import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startWatchdog } from '../src/lib/watchdog.ts';

/** Manual clock: timers fire only when `advance` passes their time. */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    timers: {
      set: (fn: () => void, ms: number) => {
        const id = next++;
        pending.set(id, { at: now + ms, fn });
        return id;
      },
      clear: (h: unknown) => {
        pending.delete(h as number);
      },
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...pending.entries()]
          .filter(([, t]) => t.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
  };
}

test('fires after the silence limit and keeps firing while the stream stays quiet', () => {
  const clock = fakeTimers();
  let fired = 0;
  startWatchdog(() => fired++, 45_000, clock.timers);
  clock.advance(44_999);
  assert.equal(fired, 0);
  clock.advance(1);
  assert.equal(fired, 1);
  clock.advance(45_000);
  assert.equal(fired, 2);
});

test('any event restarts the countdown', () => {
  const clock = fakeTimers();
  let fired = 0;
  const dog = startWatchdog(() => fired++, 45_000, clock.timers);
  for (let i = 0; i < 5; i++) {
    clock.advance(20_000); // a ping every 20 s
    dog.feed();
  }
  assert.equal(fired, 0);
  clock.advance(45_000);
  assert.equal(fired, 1);
});

test('stop cancels it for good', () => {
  const clock = fakeTimers();
  let fired = 0;
  const dog = startWatchdog(() => fired++, 45_000, clock.timers);
  dog.stop();
  clock.advance(300_000);
  assert.equal(fired, 0);
  dog.feed();
  clock.advance(300_000);
  assert.equal(fired, 0);
});
