import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGlMachine, glReducer } from './gl-machine';

describe('glReducer', () => {
  it('becomes ready on a draw and failed on an error', () => {
    expect(glReducer('loading', { type: 'drew' })).toBe('ready');
    expect(glReducer('loading', { type: 'error', reason: 'x' })).toBe('failed');
    expect(glReducer('ready', { type: 'error', reason: 'x' })).toBe('failed');
  });
  it('only times out while loading, and failed is final', () => {
    expect(glReducer('loading', { type: 'timeout' })).toBe('failed');
    expect(glReducer('ready', { type: 'timeout' })).toBe('ready');
    expect(glReducer('failed', { type: 'drew' })).toBe('failed');
  });
});

describe('createGlMachine', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a thrown render goes to 2D', () => {
    const onFail = vi.fn();
    const m = createGlMachine({ timeoutMs: 3000, onFail });
    m.start();
    m.dispatch({ type: 'error', reason: 'render threw' });
    expect(m.getState()).toBe('failed');
    expect(onFail).toHaveBeenCalledWith('render threw');
  });

  it('a shader error goes to 2D even after the first draw', () => {
    const m = createGlMachine({ timeoutMs: 3000 });
    m.start();
    m.dispatch({ type: 'drew' });
    m.dispatch({ type: 'error', reason: 'shader error' });
    expect(m.getState()).toBe('failed');
  });

  it('no successful draw within 3 s goes to 2D', () => {
    const onFail = vi.fn();
    const m = createGlMachine({ timeoutMs: 3000, onFail });
    m.start();
    vi.advanceTimersByTime(2999);
    expect(m.getState()).toBe('loading');
    vi.advanceTimersByTime(1);
    expect(m.getState()).toBe('failed');
    expect(onFail).toHaveBeenCalledOnce();
  });

  it('a draw in time keeps 3D and cancels the watchdog', () => {
    const m = createGlMachine({ timeoutMs: 3000 });
    m.start();
    vi.advanceTimersByTime(1000);
    m.dispatch({ type: 'drew' });
    vi.advanceTimersByTime(10_000);
    expect(m.getState()).toBe('ready');
  });

  it('does not run before start, and pause/resume keeps the time left', () => {
    const m = createGlMachine({ timeoutMs: 3000 });
    vi.advanceTimersByTime(10_000);
    expect(m.getState()).toBe('loading');
    m.start();
    vi.advanceTimersByTime(2000);
    m.pause();
    vi.advanceTimersByTime(60_000);
    expect(m.getState()).toBe('loading');
    m.resume();
    vi.advanceTimersByTime(999);
    expect(m.getState()).toBe('loading');
    vi.advanceTimersByTime(1);
    expect(m.getState()).toBe('failed');
  });

  it('notifies subscribers once per change', () => {
    const m = createGlMachine({ timeoutMs: 3000 });
    const l = vi.fn();
    m.subscribe(l);
    m.dispatch({ type: 'drew' });
    m.dispatch({ type: 'drew' });
    expect(l).toHaveBeenCalledOnce();
  });
});
