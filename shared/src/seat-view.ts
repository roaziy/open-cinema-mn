export const EYE_HEIGHT_M = 1.15;
export const SCREEN_BOTTOM_M = 1.2;

export type SeatViewLabel = 'very_close' | 'angled' | 'immersive' | 'balanced';

const DEG = 180 / Math.PI;

export function seatViewStats(
  seat: { x_m: number; y_m: number; z_m: number },
  hall: { screen_width_m: number; screen_height_m: number; screen_x_m: number },
): { distanceM: number; viewDeg: number; offCenterDeg: number; label: SeatViewLabel } {
  const dx = seat.x_m - hall.screen_x_m;
  const dy = seat.y_m;
  const dz = seat.z_m + EYE_HEIGHT_M - (SCREEN_BOTTOM_M + hall.screen_height_m / 2);
  const distanceM = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const viewDeg = 2 * Math.atan(hall.screen_width_m / 2 / distanceM) * DEG;
  const offCenterDeg = Math.atan(Math.abs(dx) / distanceM) * DEG;
  let label: SeatViewLabel;
  if (viewDeg > 90) label = 'very_close';
  else if (offCenterDeg > 20) label = 'angled';
  else if (viewDeg >= 50) label = 'immersive';
  else label = 'balanced';
  return { distanceM, viewDeg, offCenterDeg, label };
}
