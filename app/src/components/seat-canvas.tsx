import { useEffect, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
} from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import type { SeatLayout } from '@/lib/seat-layout';
import { colors, space } from '@/theme/tokens';
import { type } from '@/theme/type';
import { ScreenArc } from './screen-arc';
import { SeatCell, type SeatStatus } from './seat-cell';

const GUTTER = 22; // row letters live here, on both sides
const ARC_GAP = space.md;
const MAX_ZOOM = 3.5;

type Props = {
  layout: SeatLayout;
  tone: string;
  /** Called with a seat id when a seat is tapped. */
  onSeat: (seatId: string) => void;
  statusOf: (seatId: string) => SeatStatus;
  labelOf: (seatId: string, status: SeatStatus) => string;
};

/** Width the seat grid should be laid out for inside a viewport this wide. */
export function seatAreaWidth(viewportWidth: number): number {
  return Math.max(0, viewportWidth - GUTTER * 2);
}

const clamp = (v: number, lo: number, hi: number) => {
  'worklet';
  return Math.min(hi, Math.max(lo, v));
};

/** The screen arc, row letters and seats on a canvas you can pinch to zoom and drag around. */
export function SeatCanvas({ layout, tone, onSeat, statusOf, labelOf }: Props) {
  const [view, setView] = useState({ w: 0, h: 0 });
  const arcH = 78 + ARC_GAP;
  const cw = layout.width + GUTTER * 2;
  const ch = arcH + layout.height + space.lg;

  // Fit the whole hall at first; never zoom out past that.
  const fit = view.h > 0 ? Math.min(1, view.h / ch) : 1;

  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
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
      <View style={styles.viewport} onLayout={onLayout}>
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
              {layout.rows.map((r) => (
                <View key={r.label} pointerEvents="none">
                  <View
                    style={[styles.letter, { top: r.top, left: -GUTTER, height: layout.rowStep }]}
                  >
                    <Text style={styles.rowLetter}>{r.label}</Text>
                  </View>
                  <View
                    style={[
                      styles.letter,
                      { top: r.top, left: layout.width, height: layout.rowStep },
                    ]}
                  >
                    <Text style={styles.rowLetter}>{r.label}</Text>
                  </View>
                </View>
              ))}
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
