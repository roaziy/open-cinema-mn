import { describe, expect, it } from 'vitest';
import { formatMarks } from './format-marks';

describe('formatMarks', () => {
  it('names the format and drops a hall name that only repeats it', () => {
    expect(formatMarks('IMAX', 'IMAX')).toEqual({ marks: ['IMAX'], hall: null });
    expect(formatMarks('3D', '3D танхим')).toEqual({ marks: ['3D'], hall: null });
    expect(formatMarks('2D', '2D танхим')).toEqual({ marks: ['2D'], hall: null });
  });

  it('adds Dolby and VIP marks from the hall name', () => {
    expect(formatMarks('3D', '3D Dolby Vision')).toEqual({
      marks: ['3D', 'DOLBY VISION'],
      hall: null,
    });
    expect(formatMarks('2D', 'VIP')).toEqual({ marks: ['2D', 'VIP'], hall: null });
    expect(formatMarks('2D', 'Dolby Atmos 4')).toEqual({ marks: ['2D', 'DOLBY ATMOS'], hall: '4' });
  });

  it('keeps the part of the hall name the marks do not say', () => {
    expect(formatMarks('2D', 'Жижиг танхим')).toEqual({ marks: ['2D'], hall: 'Жижиг танхим' });
    expect(formatMarks('2D', 'Танхим 1')).toEqual({ marks: ['2D'], hall: 'Танхим 1' });
  });
});
