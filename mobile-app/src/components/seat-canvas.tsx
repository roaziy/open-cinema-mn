import { type ReactNode, type RefObject, useEffect, useState } from 'react';
import { type HostInstance, type LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
} from 'react-native-gesture-handler';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { type CamState, type MapFit, projectToPx } from '@/features/seat-view/camera-math';
import type { SeatLayout } from '@/lib/seat-layout';
import { colors, space } from '@/theme/tokens';
import { type } from '@/theme/type';
import { ScreenArc } from './screen-arc';
import { SeatCell, type SeatStatus } from './seat-cell';

const GUTTER = 22; // row letters live here, on both sides
const ARC_GAP = space.md;
const MAX_ZOOM = 3.5;

/** The canvas's pan/zoom, owned by the screen so the 3D view can start from what is on screen. */
export type SeatTransform = {
  scale: SharedValue<number>;
  tx: SharedValue<number>;
  ty: SharedValue<number>;
};

export function useSeatTransform(): SeatTransform {
  return { scale: useSharedValue(1), tx: useSharedValue(0), ty: useSharedValue(0) };
}

type Props = {
  layout: SeatLayout;
  transform: SeatTransform;
  /** The fixed viewport the canvas pans inside; the screen measures it. */
  viewportRef: RefObject<HostInstance | null>;
  tone: string;
  /** Called with a seat id when a seat is tapped. */
  onSeat: (seatId: string) => void;
  statusOf: (seatId: string) => SeatStatus;
  labelOf: (seatId: string, status: SeatStatus) => string;
};

/** Size of the canvas content (screen arc, gutters, seats) and where the seat grid starts in it. */
export function seatContentMetrics(layout: SeatLayout) {
  const arcH = 78 + ARC_GAP;
  return {
    width: layout.width + GUTTER * 2,
    height: arcH + layout.height + space.lg,
    origin: { x: GUTTER, y: arcH },
  };
}

/** Width the seat grid should be laid out for inside a viewport this wide. */
export function seatAreaWidth(viewportWidth: number): number {
  return Math.max(0, viewportWidth - GUTTER * 2);
}

const clamp = (v: number, lo: number, hi: number) => {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
};

const noop = () => {};

/** The row letters down both sides of the seat grid (shared by the canvas and the hand-off layer, so they cannot drift apart). */
function RowLetters({ layout }: { layout: SeatLayout }) {
  return (
    <>
      {layout.rows.map((r) => (
        <View key={r.label} pointerEvents="none">
          <View style={[styles.letter, { top: r.top, left: -GUTTER, height: layout.rowStep }]}>
            <Text style={styles.rowLetter}>{r.label}</Text>
          </View>
          <View style={[styles.letter, { top: r.top, left: layout.width, height: layout.rowStep }]}>
            <Text style={styles.rowLetter}>{r.label}</Text>
          </View>
        </View>
      ))}
    </>
  );
}

/** The screen arc, row letters and seats on a canvas you can pinch to zoom and drag around. */
export function SeatCanvas({
  layout,
  transform,
  viewportRef,
  tone,
  onSeat,
  statusOf,
  labelOf,
}: Props) {
  const [view, setView] = useState({ w: 0, h: 0 });
  const { width: cw, height: ch, origin } = seatContentMetrics(layout);
  const arcH = origin.y;

  // Fit the whole hall at first; never zoom out past that.
  const fit = view.h > 0 ? Math.min(1, view.h / ch) : 1;

  const { scale, tx, ty } = transform;
  const vw = useSharedValue(0);
  const vh = useSharedValue(0);
  const minScale = useSharedValue(1);
  const cwv = useSharedValue(cw);
  const chv = useSharedValue(ch);

  // New viewport or new hall: reset the camera to "whole hall".
  useEffect(() => {
    if (view.w === 0) return;
    vw.set(view.w);
    vh.set(view.h);
    cwv.set(cw);
    chv.set(ch);
    minScale.set(fit);
    scale.set(fit);
    tx.set(0);
    ty.set(0);
  }, [view.w, view.h, cw, ch, fit, vw, vh, cwv, chv, minScale, scale, tx, ty]);

  const pan = usePanGesture({
    minDistance: 6,
    onUpdate: (e) => {
      'worklet';
      const exX = Math.max(0, (cwv.get() * scale.get() - vw.get()) / 2);
      const exY = Math.max(0, (chv.get() * scale.get() - vh.get()) / 2);
      tx.set(clamp(tx.get() + e.changeX, -exX, exX));
      ty.set(clamp(ty.get() + e.changeY, -exY, exY));
    },
  });

  const pinch = usePinchGesture({
    onUpdate: (e) => {
      'worklet';
      const from = scale.get();
      const to = clamp(from * e.scaleChange, minScale.get(), MAX_ZOOM);
      const k = to / from;
      // Keep the point under the fingers where it is.
      const fx = e.focalX - vw.get() / 2;
      const fy = e.focalY - vh.get() / 2;
      const exX = Math.max(0, (cwv.get() * to - vw.get()) / 2);
      const exY = Math.max(0, (chv.get() * to - vh.get()) / 2);
      tx.set(clamp(fx - (fx - tx.get()) * k, -exX, exX));
      ty.set(clamp(fy - (fy - ty.get()) * k, -exY, exY));
      scale.set(to);
    },
  });

  const gesture = useSimultaneousGestures(pan, pinch);

  const anim = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.get() }, { translateY: ty.get() }, { scale: scale.get() }],
  }));

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setView((v) => (v.w === width && v.h === height ? v : { w: width, h: height }));
  };

  return (
    // The detector sits on the fixed viewport (not on the moving canvas), so the margins
    // around the hall pan and pinch too and focal points are in viewport coordinates.
    <GestureDetector gesture={gesture}>
      <View ref={viewportRef} style={styles.viewport} onLayout={onLayout} collapsable={false}>
        {view.w > 0 ? (
          <Animated.View
            style={[
              styles.canvas,
              { width: cw, height: ch, left: (view.w - cw) / 2, top: (view.h - ch) / 2 },
              anim,
            ]}
          >
            <ScreenArc width={cw} tone={tone} />
            <View style={{ position: 'absolute', left: GUTTER, top: arcH }}>
              <RowLetters layout={layout} />
              {layout.slots.map(({ seat, left, top }) => {
                if (seat.kind === 'blocked') return null;
                const status = statusOf(seat.id);
                return (
                  <SeatCell
                    key={seat.id}
                    id={seat.id}
                    left={left}
                    top={top}
                    size={layout.size}
                    kind={seat.kind}
                    status={status}
                    label={labelOf(seat.id, status)}
                    onPress={onSeat}
                  />
                );
              })}
            </View>
          </Animated.View>
        ) : null}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden' },
  canvas: { position: 'absolute' },
  letter: { position: 'absolute', width: GUTTER, justifyContent: 'center', alignItems: 'center' },
  rowLetter: { ...type.footnote, fontSize: 10, color: colors.muted },
});

type LandmarkProps = {
  layout: SeatLayout;
  transform: SeatTransform;
  /** How the map's content pixels relate to hall metres. */
  fit: MapFit;
  /** Height (m) the content plane is matched at (the arc and the row letters sit on it). */
  planeY: number;
  /** The live 3D camera. */
  cam: SharedValue<CamState>;
  tone: string;
  statusOf: (seatId: string) => SeatStatus;
  /** 0..1: how much of the layer shows. */
  opacity: SharedValue<number>;
};

const projOut: [number, number, number] = [0, 0, 0];
const projRef: [number, number, number] = [0, 0, 0];

type AnchorProps = {
  /** The hall point it belongs to (a seat, or the plane at its content position). */
  world: [number, number, number];
  w: number;
  h: number;
  cam: SharedValue<CamState>;
  transform: SeatTransform;
  fit: MapFit;
  children: ReactNode;
};

/**
 * One landmark, placed where the live 3D camera draws its hall point and scaled by how big the
 * grid is drawn right now relative to the 2D map: it rides on the moving 3D grid and lands on
 * its 2D position when the camera does.
 */
function Anchored({ world, w, h, cam, transform, fit, children }: AnchorProps) {
  const style = useAnimatedStyle(() => {
    const c = cam.get();
    projectToPx(c, world[0], world[1], world[2], projOut);
    // pixels per content pixel along x, at this point
    const step = 1 / fit.ppmX;
    projectToPx(c, world[0] + step, world[1], world[2], projRef);
    const k = Math.abs(projRef[0] - projOut[0]) / Math.max(1e-6, transform.scale.get());
    return {
      opacity: projOut[2] ? 1 : 0,
      transform: [
        { translateX: projOut[0] - w / 2 },
        { translateY: projOut[1] - h / 2 },
        { scale: k },
      ],
    };
  });
  return (
    <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: w, height: h }, style]}>
      {children}
    </Animated.View>
  );
}

/**
 * The parts of the map that have no 3D counterpart (screen arc and label, row letters, seat
 * icons). Each is projected through the live 3D camera every frame, so while the camera settles
 * they ride on the 3D grid and converge exactly to the 2D layout at landing. Not interactive.
 */
export function SeatLandmarks({
  layout,
  transform,
  fit,
  planeY,
  cam,
  tone,
  statusOf,
  opacity,
}: LandmarkProps) {
  const { width: cw, origin } = seatContentMetrics(layout);
  const anim = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  const onPlane = (cx: number, cy: number): [number, number, number] => [
    (cx - fit.x0) / fit.ppmX,
    planeY,
    (cy - fit.y0) / fit.ppmY,
  ];
  const arcH = origin.y - ARC_GAP;
  const common = { cam, transform, fit };
  return (
    <Animated.View style={[StyleSheet.absoluteFill, anim]} pointerEvents="none">
      <Anchored {...common} world={onPlane(cw / 2, arcH / 2)} w={cw} h={arcH}>
        <ScreenArc width={cw} tone={tone} />
      </Anchored>
      {layout.rows.flatMap((r) =>
        [origin.x - GUTTER / 2, origin.x + layout.width + GUTTER / 2].map((cx) => {
          const cy = origin.y + r.top + layout.rowStep / 2;
          return (
            <Anchored
              key={`${r.label}${cx}`}
              {...common}
              world={onPlane(cx, cy)}
              w={GUTTER}
              h={layout.rowStep}
            >
              <View style={[styles.letter, { left: 0, top: 0, height: layout.rowStep }]}>
                <Text style={styles.rowLetter}>{r.label}</Text>
              </View>
            </Anchored>
          );
        }),
      )}
      {layout.slots.map(({ seat }) => {
        if (seat.kind === 'blocked') return null;
        const status = statusOf(seat.id);
        if (status === 'free' && seat.kind !== 'wheelchair' && seat.kind !== 'premium') return null;
        return (
          <Anchored
            key={seat.id}
            {...common}
            world={[seat.x_m, seat.z_m + 0.5, seat.y_m]}
            w={layout.size}
            h={layout.size}
          >
            <SeatCell
              id={seat.id}
              left={0}
              top={0}
              size={layout.size}
              kind={seat.kind}
              status={status}
              label=""
              onPress={noop}
              glyphsOnly
            />
          </Anchored>
        );
      })}
    </Animated.View>
  );
}
