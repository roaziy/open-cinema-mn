/**
 * Phases of the in-place seat map <-> 3D transition, as a pure reducer so every way of leaving
 * (back, swipe, holds expiring, GL failing at any point, Reduce Motion) is one tested table.
 *
 * mounting -> fading-in -> diving -> arrived -> leaving -> fading-out -> closed
 */
export type Phase =
  | 'mounting'
  | 'fading-in'
  | 'diving'
  | 'arrived'
  | 'leaving'
  | 'fading-out'
  | 'closed';

export type Transition = {
  phase: Phase;
  /** GL is unusable: the 2D diagram takes the canvas's place. */
  fallback: boolean;
  /** The 2D diagram has finished fading in over the canvas. */
  fallbackShown: boolean;
  /** No flights: crossfade straight to the seat and back (Reduce Motion). */
  still: boolean;
  /** Dev only: stay on the top-down start. */
  hold: boolean;
};

export type TransitionEvent =
  /** The first real frame was drawn. */
  | { type: 'ready' }
  /** GL failed (watchdog, thrown render, shader error, lost context) or was forced off. */
  | { type: 'failed' }
  /** The map-to-3D crossfade finished. */
  | { type: 'faded-in' }
  /** The camera landed at the seat. */
  | { type: 'landed' }
  /** The camera landed back over the map. */
  | { type: 'landed-top' }
  /** The 2D diagram finished fading in. */
  | { type: 'fallback-shown' }
  /** Any way of leaving: back, swipe, holds expired. */
  | { type: 'close' }
  /** The 3D-to-map crossfade finished. */
  | { type: 'faded-out' }
  /** The flight home never reported. */
  | { type: 'timeout' };

export function initialTransition(opts: {
  still: boolean;
  hold: boolean;
  forceFallback: boolean;
}): Transition {
  return {
    phase: opts.forceFallback ? 'fading-in' : 'mounting',
    fallback: opts.forceFallback,
    fallbackShown: false,
    still: opts.still,
    hold: opts.hold,
  };
}

const flies = (s: Transition) => !s.still && !s.hold && !s.fallback;

export function transitionReducer(s: Transition, e: TransitionEvent): Transition {
  const to = (phase: Phase, patch: Partial<Transition> = {}): Transition => ({
    ...s,
    ...patch,
    phase,
  });
  switch (e.type) {
    case 'ready':
      return s.phase === 'mounting' ? to('fading-in') : s;
    case 'failed':
      if (s.fallback) return s;
      switch (s.phase) {
        case 'mounting':
          return to('fading-in', { fallback: true });
        case 'leaving':
          // Nothing will fly any more: crossfade back from wherever the camera is.
          return to('fading-out', { fallback: true });
        case 'diving':
          // The dive will never land: the diagram is what there is to look at.
          return to('arrived', { fallback: true });
        default:
          return { ...s, fallback: true };
      }
    case 'faded-in':
      if (s.phase !== 'fading-in') return s;
      return flies(s) ? to('diving') : to('arrived');
    case 'landed':
      return s.phase === 'diving' ? to('arrived') : s;
    case 'landed-top':
      return s.phase === 'leaving' ? to('fading-out') : s;
    case 'fallback-shown':
      return { ...s, fallbackShown: true };
    case 'timeout':
      return s.phase === 'leaving' ? to('fading-out') : s;
    case 'close':
      switch (s.phase) {
        case 'mounting':
          // Never showed anything: the map was never covered.
          return to('closed');
        case 'fading-in':
          return to('fading-out');
        case 'diving':
        case 'arrived':
          return flies(s) ? to('leaving') : to('fading-out');
        default:
          return s;
      }
    case 'faded-out':
      return s.phase === 'fading-out' ? to('closed') : s;
  }
}

/** Where the camera should be heading. */
export function goalOf(s: Transition): 'top' | 'pov' {
  if (s.still) return 'pov';
  return s.phase === 'diving' || s.phase === 'arrived' ? 'pov' : 'top';
}

/** The stats panel can be used. */
export const panelLive = (s: Transition) => s.phase === 'arrived';
