import type { SeatMap, SeatState } from '@open-cinema/shared';
import { EYE_HEIGHT_M, SCREEN_BOTTOM_M } from '@open-cinema/shared';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Polygon, Rect } from 'react-native-svg';
import { useI18n } from '@/i18n';
import { colors, radius, space } from '@/theme/tokens';
import { type } from '@/theme/type';
import { hallExtents, hallHalfWidth } from './camera-math';

type Props = {
  seats: SeatState[];
  hall: SeatMap['hall'];
  tone: string;
  selectedIds: string[];
  currentId: string;
  width: number;
};

const PAD = 14;
const FLOOR = '#26262D';
const SEAT = '#3A3A42';

/** The 3D view's stand-in: a real side profile and a top-down mini map with the seat marked. */
export function Hall2D({ seats, hall, tone, selectedIds, currentId, width }: Props) {
  const { t } = useI18n();
  const ext = useMemo(() => hallExtents(seats), [seats]);
  const current = seats.find((s) => s.id === currentId);
  const inner = width - space.lg * 2 - space.md * 2;
  return (
    <View style={styles.wrap}>
      <Text style={styles.note}>{t('view.fallbackNote')}</Text>
      <View style={styles.card}>
        <Text style={styles.cap}>{t('view.sideProfile')}</Text>
        <SideProfile
          seats={seats}
          hall={hall}
          tone={tone}
          ext={ext}
          current={current}
          width={inner}
        />
      </View>
      <View style={styles.card}>
        <Text style={styles.cap}>{t('view.topDown')}</Text>
        <TopDown
          seats={seats}
          hall={hall}
          tone={tone}
          ext={ext}
          selectedIds={selectedIds}
          current={current}
          width={inner}
        />
      </View>
    </View>
  );
}

type Ext = ReturnType<typeof hallExtents>;

function SideProfile({
  seats,
  hall,
  tone,
  ext,
  current,
  width,
}: {
  seats: SeatState[];
  hall: SeatMap['hall'];
  tone: string;
  ext: Ext;
  current: SeatState | undefined;
  width: number;
}) {
  const depth = ext.maxY + 1.5;
  const top = Math.max(SCREEN_BOTTOM_M + hall.screen_height_m, ext.maxZ + EYE_HEIGHT_M + 0.6) + 0.3;
  const k = Math.min((width - PAD * 2) / depth, 200 / top);
  const w = depth * k + PAD * 2;
  const h = top * k + PAD * 2;
  const px = (y: number) => PAD + y * k;
  const py = (z: number) => h - PAD - z * k;

  const rows = useMemo(() => {
    const byRow = new Map<string, { y: number; z: number; n: number }>();
    for (const s of seats) {
      const r = byRow.get(s.rowLabel) ?? { y: 0, z: 0, n: 0 };
      r.y += s.y_m;
      r.z += s.z_m;
      r.n++;
      byRow.set(s.rowLabel, r);
    }
    return [...byRow.values()]
      .map((r) => ({ y: r.y / r.n, z: r.z / r.n }))
      .sort((a, b) => a.y - b.y);
  }, [seats]);

  // Stepped floor: each row owns the stretch halfway to its neighbours.
  let floor = `M ${px(0)} ${py(0)}`;
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    const next = rows[i + 1];
    const from = prev ? (prev.y + r.y) / 2 : 0;
    const to = next ? (r.y + next.y) / 2 : depth;
    floor += ` L ${px(from)} ${py(Math.max(r.z, 0.04))} L ${px(to)} ${py(Math.max(r.z, 0.04))}`;
  });
  floor += ` L ${px(depth)} ${py(0)} Z`;

  const eyeX = current ? px(current.y_m) : 0;
  const eyeY = current ? py(current.z_m + EYE_HEIGHT_M) : 0;
  const sTop = py(SCREEN_BOTTOM_M + hall.screen_height_m);
  const sBot = py(SCREEN_BOTTOM_M);

  return (
    <Svg width={w} height={h} style={styles.svg}>
      <Path d={floor} fill={FLOOR} />
      {rows.map((r) => (
        <Rect
          key={r.y}
          x={px(r.y) - 0.2 * k}
          y={py(r.z + 0.7)}
          width={0.4 * k}
          height={0.7 * k}
          rx={Math.min(3, 0.1 * k)}
          fill={SEAT}
        />
      ))}
      {current ? (
        <>
          <Polygon
            points={`${eyeX},${eyeY} ${px(0)},${sTop} ${px(0)},${sBot}`}
            fill={colors.action}
            fillOpacity={0.18}
          />
          <Line
            x1={eyeX}
            y1={eyeY}
            x2={px(0)}
            y2={sTop}
            stroke={colors.action}
            strokeOpacity={0.6}
            strokeWidth={1}
          />
          <Line
            x1={eyeX}
            y1={eyeY}
            x2={px(0)}
            y2={sBot}
            stroke={colors.action}
            strokeOpacity={0.6}
            strokeWidth={1}
          />
          <Circle cx={eyeX} cy={eyeY} r={5} fill={colors.action} />
          <Circle
            cx={eyeX}
            cy={eyeY}
            r={9}
            fill="none"
            stroke={colors.action}
            strokeOpacity={0.4}
          />
        </>
      ) : null}
      <Rect x={px(0) - 4} y={sTop} width={4} height={sBot - sTop} rx={2} fill={tone} />
    </Svg>
  );
}

function TopDown({
  seats,
  hall,
  tone,
  ext,
  selectedIds,
  current,
  width,
}: {
  seats: SeatState[];
  hall: SeatMap['hall'];
  tone: string;
  ext: Ext;
  selectedIds: string[];
  current: SeatState | undefined;
  width: number;
}) {
  const half = hallHalfWidth(ext, hall);
  const depth = ext.maxY + 1.5;
  const k = Math.min((width - PAD * 2) / (half * 2), 260 / depth);
  const w = half * 2 * k + PAD * 2;
  const barH = 6;
  const h = depth * k + PAD * 2 + barH;
  const px = (x: number) => PAD + (x + half) * k;
  const py = (y: number) => PAD + barH + y * k;
  const sx0 = px(hall.screen_x_m - hall.screen_width_m / 2);
  const sx1 = px(hall.screen_x_m + hall.screen_width_m / 2);
  const r = Math.max(2, 0.2 * k);

  return (
    <Svg width={w} height={h} style={styles.svg}>
      <Rect x={PAD} y={PAD + barH} width={half * 2 * k} height={depth * k} rx={6} fill={FLOOR} />
      <Rect x={sx0} y={PAD} width={sx1 - sx0} height={barH - 1} rx={3} fill={tone} />
      {current ? (
        <Polygon
          points={`${px(current.x_m)},${py(current.y_m)} ${sx0},${py(0)} ${sx1},${py(0)}`}
          fill={colors.action}
          fillOpacity={0.16}
        />
      ) : null}
      {seats
        .filter((s) => s.kind !== 'blocked')
        .map((s) => {
          const picked = selectedIds.includes(s.id);
          return (
            <Circle
              key={s.id}
              cx={px(s.x_m)}
              cy={py(s.y_m)}
              r={picked ? r * 1.15 : r}
              fill={picked ? colors.action : SEAT}
            />
          );
        })}
      {current ? (
        <Circle
          cx={px(current.x_m)}
          cy={py(current.y_m)}
          r={r * 2}
          fill="none"
          stroke={colors.ink}
          strokeWidth={1.5}
        />
      ) : null}
    </Svg>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md, paddingHorizontal: space.lg },
  note: { ...type.caption, color: colors.muted },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderTopColor: colors.highlight,
    paddingVertical: space.md,
    gap: space.sm,
    alignItems: 'center',
    overflow: 'hidden',
  },
  cap: {
    ...type.footnote,
    color: colors.muted,
    alignSelf: 'flex-start',
    paddingHorizontal: space.md,
  },
  svg: { alignSelf: 'center' },
});
