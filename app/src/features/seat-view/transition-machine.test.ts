import { describe, expect, it } from 'vitest';
import {
  goalOf,
  initialTransition,
  panelLive,
  type TransitionEvent,
  transitionReducer,
} from './transition-machine';

const run = (events: TransitionEvent['type'][], opts = {}) => {
  let s = initialTransition({ still: false, hold: false, forceFallback: false, ...opts });
  const seen = [s.phase];
  for (const type of events) {
    s = transitionReducer(s, { type } as TransitionEvent);
    seen.push(s.phase);
  }
  return { s, seen };
};

describe('opening', () => {
  it('goes mounting, fading-in, diving, arrived', () => {
    const { s, seen } = run(['ready', 'faded-in', 'landed']);
    expect(seen).toEqual(['mounting', 'fading-in', 'diving', 'arrived']);
    expect(goalOf(s)).toBe('pov');
    expect(panelLive(s)).toBe(true);
  });
  it('stays top-down until the crossfade is done', () => {
    expect(goalOf(run(['ready']).s)).toBe('top');
  });
  it('with Reduce Motion goes straight to arrived and never flies', () => {
    const { s, seen } = run(['ready', 'faded-in'], { still: true });
    expect(seen).toEqual(['mounting', 'fading-in', 'arrived']);
    expect(goalOf(s)).toBe('pov');
  });
  it('with a forced fallback fades the diagram in and arrives', () => {
    const { s, seen } = run(['faded-in'], { forceFallback: true });
    expect(seen).toEqual(['fading-in', 'arrived']);
    expect(s.fallback).toBe(true);
  });
});

describe('every way out', () => {
  it('back before anything drew: closes at once, map untouched', () => {
    expect(run(['close']).s.phase).toBe('closed');
  });
  it('back during the crossfade: crossfades back without flying', () => {
    expect(run(['ready', 'close', 'faded-out']).seen).toEqual([
      'mounting',
      'fading-in',
      'fading-out',
      'closed',
    ]);
  });
  it('swipe mid-dive: flies home, then crossfades', () => {
    const { seen, s } = run(['ready', 'faded-in', 'close', 'landed-top', 'faded-out']);
    expect(seen).toEqual(['mounting', 'fading-in', 'diving', 'leaving', 'fading-out', 'closed']);
    expect(goalOf({ ...s, phase: 'leaving' })).toBe('top');
  });
  it('back from the seat (also holds expiring): same path', () => {
    expect(run(['ready', 'faded-in', 'landed', 'close']).s.phase).toBe('leaving');
  });
  it('a flight home that never reports is cut by the guard', () => {
    expect(run(['ready', 'faded-in', 'landed', 'close', 'timeout']).s.phase).toBe('fading-out');
  });
  it('Reduce Motion: crossfades back without a flight', () => {
    expect(run(['ready', 'faded-in', 'close'], { still: true }).s.phase).toBe('fading-out');
  });
  it('dev hold: no flight home either', () => {
    expect(run(['ready', 'faded-in', 'close'], { hold: true }).s.phase).toBe('fading-out');
  });
  it('ignores a second close and stray events', () => {
    const { s } = run(['ready', 'faded-in', 'landed', 'close', 'close', 'landed', 'faded-in']);
    expect(s.phase).toBe('leaving');
  });
});

describe('the staged hand-off', () => {
  it('starts the crossfade before landing and closes once it ends', () => {
    const { s } = run(['ready', 'faded-in', 'landed', 'close', 'near-landing']);
    expect(s.phase).toBe('leaving');
    expect(s.handoff).toBe(true);
    expect(
      run(['ready', 'faded-in', 'landed', 'close', 'near-landing', 'landed-top']).s.phase,
    ).toBe('fading-out');
    expect(
      run(['ready', 'faded-in', 'landed', 'close', 'near-landing', 'landed-top', 'faded-out']).s
        .phase,
    ).toBe('closed');
    expect(run(['ready', 'faded-in', 'landed', 'close', 'near-landing', 'faded-out']).s.phase).toBe(
      'closed',
    );
  });
  it('ignores a near-landing outside a flight home', () => {
    expect(run(['ready', 'faded-in', 'landed', 'near-landing']).s.handoff).toBe(false);
  });
});

describe('GL failing', () => {
  it('before the first frame: the diagram fades in instead', () => {
    const { s, seen } = run(['failed', 'faded-in']);
    expect(seen).toEqual(['mounting', 'fading-in', 'arrived']);
    expect(s.fallback).toBe(true);
  });
  it('after fade-in, mid-dive: settles as arrived with the fallback, leaving does not fly', () => {
    const a = run(['ready', 'faded-in', 'failed']);
    expect(a.s.phase).toBe('arrived');
    expect(a.s.fallback).toBe(true);
    expect(transitionReducer(a.s, { type: 'close' }).phase).toBe('fading-out');
  });
  it('while flying home: crossfades back from where it is', () => {
    const a = run(['ready', 'faded-in', 'landed', 'close', 'failed']);
    expect(a.s.phase).toBe('fading-out');
  });
  it('then lets the diagram finish fading in', () => {
    expect(run(['ready', 'faded-in', 'landed', 'failed', 'fallback-shown']).s.fallbackShown).toBe(
      true,
    );
  });
});
