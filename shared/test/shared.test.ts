import { describe, expect, it } from 'vitest';
import {
  AdminMovieBody,
  avoidOrange,
  formatMnt,
  formatUbTime,
  generateSeats,
  HallGenParams,
  HoldCreateBody,
  HUES,
  hueFor,
  normalizeEmail,
  normalizePhone,
  OtpVerifyBody,
  seatPrice,
  seatViewStats,
  ubBusinessDate,
  ubBusinessDayRange,
  ubDate,
  ubDayRange,
} from '../src/index';

describe('money', () => {
  it('formats MNT', () => {
    expect(formatMnt(15000)).toBe('₮15,000');
    expect(formatMnt(0)).toBe('₮0');
    expect(formatMnt(1234567)).toBe('₮1,234,567');
  });
});

describe('time', () => {
  it('ubDate uses Ulaanbaatar day', () => {
    expect(ubDate('2026-11-08T16:30:00Z')).toBe('2026-11-09');
    expect(ubDate(new Date('2026-11-08T15:59:00Z'))).toBe('2026-11-08');
  });
  it('formatUbTime', () => {
    expect(formatUbTime('2026-11-08T11:30:00Z')).toBe('19:30');
    expect(formatUbTime('2026-11-08T16:30:00Z')).toBe('00:30');
  });
  it('ubDayRange returns UTC instants', () => {
    const r = ubDayRange('2026-11-09');
    expect(r.start.toISOString()).toBe('2026-11-08T16:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-11-09T16:00:00.000Z');
    expect(ubDate(r.start)).toBe('2026-11-09');
    expect(ubDate(new Date(r.end.getTime() - 1))).toBe('2026-11-09');
  });
});

describe('business day', () => {
  it('a show after midnight belongs to the evening before', () => {
    // 00:10 on 9 Nov UB is 16:10Z on 8 Nov
    expect(ubBusinessDate('2026-11-08T16:10:00Z')).toBe('2026-11-08');
    expect(ubBusinessDate('2026-11-08T23:50:00Z')).toBe('2026-11-09'); // 07:50 UB on 9 Nov
    expect(ubBusinessDate('2026-11-08T20:59:00Z')).toBe('2026-11-08'); // 04:59 UB on 9 Nov
    expect(ubBusinessDate('2026-11-08T21:00:00Z')).toBe('2026-11-09'); // 05:00 UB on 9 Nov
  });
  it('range runs from 05:00 to 05:00 UB', () => {
    const r = ubBusinessDayRange('2026-11-09');
    expect(r.start.toISOString()).toBe('2026-11-08T21:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-11-09T21:00:00.000Z');
  });
});

describe('seatPrice', () => {
  it('charges premium seats the premium price and every other kind the standard one', () => {
    const prices = { priceStandard: 12000, pricePremium: 19000 };
    expect(seatPrice('premium', prices)).toBe(19000);
    expect(seatPrice('standard', prices)).toBe(12000);
    expect(seatPrice('wheelchair', prices)).toBe(12000);
  });
});

describe('normalize', () => {
  it('phone', () => {
    expect(normalizePhone('+976 9911 2045')).toBe('+97699112045');
    expect(normalizePhone('99112045')).toBe('+97699112045');
    expect(normalizePhone('97699112045')).toBe('+97699112045');
    expect(normalizePhone('9911-2045')).toBe('+97699112045');
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('+97699112045678')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });
  it('email', () => {
    expect(normalizeEmail(' Bat@Mail.MN ')).toBe('bat@mail.mn');
    expect(normalizeEmail('nope')).toBeNull();
    expect(normalizeEmail('a@b')).toBeNull();
    expect(normalizeEmail('link:0000:x@y.mn')).toBeNull();
    expect(normalizeEmail('a:b@y.mn')).toBeNull();
  });
});

describe('seatViewStats', () => {
  const hall = { screen_width_m: 12, screen_height_m: 5.4, screen_x_m: 0 };
  it('computes distance, angle, label', () => {
    const a = seatViewStats({ x_m: 0, y_m: 9, z_m: 0.75 }, hall);
    expect(a.distanceM).toBeCloseTo(9.22, 2);
    expect(a.viewDeg).toBeCloseTo(66.1, 1);
    expect(a.offCenterDeg).toBeCloseTo(0);
    expect(a.label).toBe('immersive');
  });
  it('labels', () => {
    expect(seatViewStats({ x_m: 5, y_m: 3, z_m: 0 }, hall).label).toBe('angled');
    expect(seatViewStats({ x_m: 0, y_m: 1, z_m: 0 }, hall).label).toBe('very_close');
    expect(seatViewStats({ x_m: 0, y_m: 16, z_m: 2 }, hall).label).toBe('balanced');
  });
});

describe('generateSeats', () => {
  const seats = generateSeats({
    rows: 10,
    seatsPerRow: 12,
    seatPitchM: 0.55,
    rowSpacingM: 1,
    aisleAfter: [3, 9],
    firstRowDistanceM: 4,
    risePerRowM: 0.15,
  });
  const at = (r: string, n: number) => {
    const seat = seats.find((s) => s.rowLabel === r && s.number === n);
    if (!seat) throw new Error(`missing seat ${r}${n}`);
    return seat;
  };
  it('layout', () => {
    expect(seats).toHaveLength(120);
    expect(at('A', 1).x_m).toBeCloseTo(-3.575);
    expect(at('A', 12).x_m).toBeCloseTo(3.575);
    expect(at('A', 4).x_m).toBeCloseTo(-1.375);
    expect(at('F', 7).y_m).toBeCloseTo(9);
    expect(at('F', 7).z_m).toBeCloseTo(0.75);
    expect(seats.every((s) => s.kind === 'standard')).toBe(true);
  });
});

describe('contracts', () => {
  it('validates request bodies', () => {
    expect(
      OtpVerifyBody.safeParse({ channel: 'sms', target: '99112045', code: '123456' }).success,
    ).toBe(true);
    expect(HoldCreateBody.safeParse({ seatIds: [] }).success).toBe(false);
    expect(
      HallGenParams.safeParse({
        rows: 10,
        seatsPerRow: 12,
        seatPitchM: 0.55,
        rowSpacingM: 1,
        aisleAfter: [3],
        firstRowDistanceM: 4,
        risePerRowM: 0.15,
      }).success,
    ).toBe(true);
  });
});

describe('palette', () => {
  it('hueFor is stable, never red, and always a known hue', () => {
    expect(hueFor('branch-1')).toBe(hueFor('branch-1'));
    for (let i = 0; i < 200; i++) {
      const key = hueFor(`id-${i}`);
      expect(key in HUES).toBe(true);
      expect(key).not.toBe('red');
    }
  });
  it('avoidOrange moves orange tones and leaves the rest', () => {
    expect(avoidOrange('#F28A1E')).not.toBe('#F28A1E');
    expect(avoidOrange('#2e6bf0')).toBe('#2E6BF0');
    expect(avoidOrange('#808080')).toBe('#808080');
  });
  it('a film tone typed by hand is stored without orange', () => {
    const base = {
      title: 'T',
      synopsis: '',
      durationMin: 100,
      ageRating: '12+',
      genres: [],
      posterUrl: 'https://x.mn/p.jpg',
      releaseDate: '2026-11-01',
      status: 'now',
    };
    const parsed = AdminMovieBody.parse({ ...base, tone: '#F28A1E' });
    expect(parsed.tone).not.toBe('#F28A1E');
    expect(AdminMovieBody.parse({ ...base, tone: '#2e6bf0' }).tone).toBe('#2E6BF0');
  });
});
