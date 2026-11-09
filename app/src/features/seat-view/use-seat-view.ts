import type { SeatState } from '@open-cinema/shared';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HostInstance } from 'react-native';
import {
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';
import { type SeatTransform, seatContentMetrics } from '@/components/seat-canvas';
import { haptic } from '@/lib/haptics';
import type { SeatLayout } from '@/lib/seat-layout';
import { mapFitOf, seatPlaneHeight, type TopDownPose, topDownFromMap } from './camera-math';
import { chromeOpacity, footerSlide } from './chrome-fade';
import { handoffLook, NOT_CLOSING } from './handoff';
import type { OverlayRect } from './SeatViewOverlay';

export type Viewing = {
  seatId: string;
  takenIds: string[];
  rect: OverlayRect;
  /** The 2D map's viewport in the window's coordinates. */
  mapRect: OverlayRect;
  topPose: TopDownPose;
  closing: boolean;
};

type Args = {
  layout: SeatLayout;
  transform: SeatTransform;
  /** The hall's seats (for the seat plane's height); undefined while the map loads. */
  mapSeats: readonly SeatState[] | undefined;
  /** The seats the viewer holds. */
  selected: SeatState[];
  isTaken: (seatId: string) => boolean;
};

/**
 * The in-place 3D view of the seat map screen: opening (measuring the 2D map so the first
 * top-down frame lines up), the shared values the map's chrome and the hand-off follow, and every
 * way out (the screen's back action, the overlay's own close request).
 */
export function useSeatView({ layout, transform, mapSeats, selected, isTaken }: Args) {
  const rootRef = useRef<HostInstance>(null);
  const viewportRef = useRef<HostInstance>(null);
  const fade = useSharedValue(0);
  const dive = useSharedValue(0);
  /** NOT_CLOSING, or the dive progress at which leaving began. */
  const closingFlag = useSharedValue(NOT_CLOSING);
  const still = useReducedMotion();
  // The 2D layers with no 3D counterpart arrive over the canvas while the camera settles, and
  // leave again as the 2D grid itself reaches full opacity (no double drawing).
  const landmarks = useDerivedValue(
    () => handoffLook(dive.get(), closingFlag.get()).landmarks * fade.get(),
  );
  // The header, legend and footer stay over the 3D picture through the first part of the dive and
  // fade around its middle (see chrome-fade.ts); with Reduce Motion they follow the crossfade.
  const chromeStyle = useAnimatedStyle(() => ({
    opacity: chromeOpacity(dive.get(), fade.get(), still),
  }));
  const footerStyle = useAnimatedStyle(() => ({
    opacity: chromeOpacity(dive.get(), fade.get(), still),
    transform: [{ translateY: footerSlide(dive.get(), fade.get(), still) }],
  }));

  const [viewing, setViewing] = useState<Viewing | null>(null);
  const isViewing = viewing !== null;

  /** The top-down pose that matches the 2D map as it is right now (live pan/zoom and layout). */
  const measure = useCallback(
    (done: (topPose: TopDownPose, rect: OverlayRect, mapRect: OverlayRect) => void) => {
      const root = rootRef.current;
      const viewport = viewportRef.current;
      if (!root || !viewport) return false;
      root.measureInWindow((rx, ry, rw, rh) => {
        viewport.measureInWindow((vx, vy, vw, vh) => {
          const content = seatContentMetrics(layout);
          // The 3D canvas is the whole window; the 2D map's viewport sits at (offsetX, offsetY)
          // inside it, so the top-down frame lines up with the seats on screen.
          const topPose = topDownFromMap({
            fit: mapFitOf(layout.slots, layout.size, layout.ppm, content.origin),
            view: {
              scale: transform.scale.get(),
              tx: transform.tx.get(),
              ty: transform.ty.get(),
              viewW: vw,
              viewH: vh,
              contentW: content.width,
              contentH: content.height,
            },
            canvasW: rw,
            canvasH: rh,
            offsetX: vx - rx,
            offsetY: vy - ry,
            planeY: seatPlaneHeight(mapSeats ?? []),
          });
          done(topPose, { x: 0, y: 0, w: rw, h: rh }, { x: vx - rx, y: vy - ry, w: vw, h: vh });
        });
      });
      return true;
    },
    [layout, transform, mapSeats],
  );
  const measureRef = useRef(measure);
  useEffect(() => {
    measureRef.current = measure;
  });

  const open = () => {
    const last = selected[selected.length - 1];
    if (!last) return;
    haptic.tap();
    measure((topPose, rect, mapRect) => {
      fade.set(0);
      dive.set(0);
      setViewing({
        seatId: last.id,
        takenIds: layout.slots
          .filter(({ seat }) => seat.kind !== 'blocked' && isTaken(seat.id))
          .map(({ seat }) => seat.id),
        rect,
        mapRect,
        topPose,
        closing: false,
      });
    });
  };

  // Leaving lands on the 2D map as it is NOW, not as it was when the view opened: the map is
  // measured first, then the close starts from that pose (and the landmarks follow its rect).
  const requestClose = useCallback(() => {
    const start = () => setViewing((v) => (v && !v.closing ? { ...v, closing: true } : v));
    const measured = measureRef.current((topPose, _rect, mapRect) =>
      setViewing((v) => (v && !v.closing ? { ...v, topPose, mapRect, closing: true } : v)),
    );
    if (!measured) start();
  }, []);

  const isClosing = viewing?.closing === true;
  useEffect(() => {
    closingFlag.set(isClosing ? dive.get() : NOT_CLOSING);
  }, [isClosing, closingFlag, dive]);

  const closed = useCallback(() => {
    dive.set(0);
    fade.set(0);
    closingFlag.set(NOT_CLOSING);
    setViewing(null);
  }, [dive, fade, closingFlag]);

  // The map's data went away while viewing (an identity change clears the cache): nothing to look
  // at, so give the screen its gestures, touches and back action back.
  const hasMap = mapSeats !== undefined;
  if (viewing && !hasMap) setViewing(null);
  useEffect(() => {
    if (!isViewing) return;
    return () => {
      // Whatever ended the view, the map's own look and the shared values start clean.
      dive.set(0);
      fade.set(0);
      closingFlag.set(NOT_CLOSING);
    };
  }, [isViewing, dive, fade, closingFlag]);

  // The back button, swipe-back and the Android back key leave the 3D view first. Anything else
  // that removes the screen (a reset after logout, say) goes through untouched.
  const [guard, setGuard] = useState(true);
  const repeat = useRef<(() => void) | null>(null);
  usePreventRemove(isViewing && guard, ({ data, repeat: again }) => {
    if (data.action.type === 'GO_BACK' || data.action.type === 'POP') requestClose();
    else {
      repeat.current = again;
      setGuard(false);
    }
  });
  useEffect(() => {
    if (guard) return;
    repeat.current?.();
    repeat.current = null;
  }, [guard]);

  return {
    rootRef,
    viewportRef,
    viewing,
    isViewing,
    open,
    requestClose,
    closed,
    fade,
    dive,
    closingFlag,
    landmarks,
    chromeStyle,
    footerStyle,
  };
}
