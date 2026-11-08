import { describe, expect, it } from 'vitest';
import { imageProblem } from '../lib/client-api';
import {
  fitsUpload,
  MAX_EDGE_PX,
  MAX_SOURCE_BYTES,
  MAX_UPLOAD_BYTES,
  planResize,
} from '../lib/image-resize';

describe('imageProblem', () => {
  it('accepts jpeg, png and webp that can be shrunk in the browser', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(imageProblem({ type, size: MAX_SOURCE_BYTES })).toBeNull();
    }
  });

  it('refuses other types and absurdly large files before decoding', () => {
    expect(imageProblem({ type: 'image/gif', size: 10 })).toMatch(/JPG/);
    expect(imageProblem({ type: 'application/pdf', size: 10 })).not.toBeNull();
    expect(imageProblem({ type: 'image/png', size: MAX_SOURCE_BYTES + 1 })).toMatch(/4 MB/);
  });
});

describe('planResize', () => {
  it('keeps a file that already fits', () => {
    expect(planResize({ width: 1600, height: 2400, size: 900_000 })).toEqual({ resize: false });
    expect(planResize({ width: MAX_EDGE_PX, height: 100, size: MAX_UPLOAD_BYTES })).toEqual({
      resize: false,
    });
  });

  it('scales the longest edge down to 2400 px and keeps the ratio', () => {
    expect(planResize({ width: 4800, height: 7200, size: 9_000_000 })).toEqual({
      resize: true,
      width: 1600,
      height: 2400,
    });
    expect(planResize({ width: 6000, height: 3000, size: 2_000_000 })).toEqual({
      resize: true,
      width: 2400,
      height: 1200,
    });
  });

  it('re-encodes an oversize file even when its dimensions are small', () => {
    expect(planResize({ width: 2000, height: 3000 - 600, size: MAX_UPLOAD_BYTES + 1 })).toEqual({
      resize: true,
      width: 2000,
      height: 2400,
    });
  });
});

describe('fitsUpload', () => {
  it('allows up to 4 MB, leaving room under the 4.5 MB platform limit', () => {
    expect(fitsUpload(MAX_UPLOAD_BYTES)).toBe(true);
    expect(fitsUpload(MAX_UPLOAD_BYTES + 1)).toBe(false);
    expect(MAX_UPLOAD_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });
});
