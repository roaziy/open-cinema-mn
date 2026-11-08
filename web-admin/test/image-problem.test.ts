import { describe, expect, it } from 'vitest';
import { imageProblem, MAX_UPLOAD_BYTES } from '../lib/client-api';

describe('imageProblem', () => {
  it('accepts jpeg, png and webp up to 8 MB', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(imageProblem({ type, size: MAX_UPLOAD_BYTES })).toBeNull();
    }
  });

  it('refuses other types and oversize files before uploading', () => {
    expect(imageProblem({ type: 'image/gif', size: 10 })).toMatch(/JPG/);
    expect(imageProblem({ type: 'application/pdf', size: 10 })).not.toBeNull();
    expect(imageProblem({ type: 'image/png', size: MAX_UPLOAD_BYTES + 1 })).toMatch(/8 MB/);
  });
});
