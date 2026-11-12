import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { headerTime, passColours, ubIso } from '../src/wallet/pass';
import { makeStrip, trustedImageUrl, walletStrip } from '../src/wallet/strip';

const luminance = (rgb: string) => {
  const [r, g, b] = (rgb.match(/\d+/g) ?? []).map(Number).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe('passColours', () => {
  it('darkens a light film colour until white text reads, labels stay lighter', () => {
    for (const tone of ['#3B7C99', '#F2C14E', '#FFFFFF', '#0B0B0D']) {
      const c = passColours(tone);
      expect(luminance(c.background)).toBeLessThanOrEqual(0.035);
      expect(luminance(c.label)).toBeGreaterThan(luminance(c.background));
      expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('ubIso', () => {
  it('writes the showtime as Ulaanbaatar wall-clock time with its offset', () => {
    expect(ubIso('2026-11-12T06:45:00.000Z')).toBe('2026-11-12T14:45:00+08:00');
    expect(ubIso('2026-11-12T20:30:00.000Z')).toBe('2026-11-13T04:30:00+08:00');
  });

  it('gives the header a compact day.month and 24-hour time', () => {
    expect(headerTime('2026-11-12T06:45:00.000Z')).toBe('12.11 · 14:45');
    expect(headerTime('2026-12-31T17:05:00.000Z')).toBe('01.01 · 01:05');
  });
});

describe('makeStrip', () => {
  it('builds the three Wallet sizes, sharp at the top, melted into the pass colour below', async () => {
    const image = await sharp({
      create: { width: 960, height: 540, channels: 3, background: '#f0e0d0' },
    })
      .png()
      .toBuffer();
    const strip = await makeStrip(image, '#102030');
    const sizes = await Promise.all([strip.x1, strip.x2, strip.x3].map((b) => sharp(b).metadata()));
    expect(sizes.map((m) => [m.width, m.height])).toEqual([
      [375, 98],
      [750, 196],
      [1125, 294],
    ]);
    const { data, info } = await sharp(strip.x3)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const px = (y: number) => [...data.subarray(y * info.width * 3, y * info.width * 3 + 3)];
    expect(px(0)).toEqual([0xf0, 0xe0, 0xd0]);
    const bottom = px(info.height - 1);
    expect(
      Math.max(...bottom.map((c, i) => Math.abs(c - ([0x10, 0x20, 0x30][i] ?? 0)))),
    ).toBeLessThanOrEqual(3);
  });
});

describe('walletStrip', () => {
  const png = () =>
    sharp({ create: { width: 400, height: 200, channels: 3, background: '#555' } })
      .png()
      .toBuffer();

  it('builds once per banner and colour', async () => {
    let calls = 0;
    const load = async () => {
      calls++;
      return png();
    };
    const a = await walletStrip('https://x/banner-once.png', '#101010', load);
    const b = await walletStrip('https://x/banner-once.png', '#101010', load);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(calls).toBe(1);
  });

  it('issues no strip when the banner cannot be loaded, and retries next time', async () => {
    let calls = 0;
    const failing = async () => {
      calls++;
      throw new Error('404');
    };
    expect(await walletStrip('https://x/missing.png', '#101010', failing)).toBeNull();
    expect(await walletStrip('https://x/missing.png', '#101010', failing)).toBeNull();
    expect(calls).toBe(2);
  });
});

describe('trustedImageUrl', () => {
  const e = { API_PUBLIC_URL: 'http://localhost:8080', R2_PUBLIC_URL: 'https://media.example.com' };

  it('allows only this server’s own storage', () => {
    expect(trustedImageUrl('http://localhost:8080/media/posters/a.png', e)).toBe(true);
    expect(trustedImageUrl('https://media.example.com/media/x.png', e)).toBe(true);
  });

  it('refuses any other address, including internal ones', () => {
    for (const url of [
      'http://169.254.169.254/latest/meta-data',
      'http://127.0.0.1:5432/',
      'https://evil.example.com/a.png',
      'http://media.example.com/x.png',
      'file:///etc/passwd',
      'not a url',
    ]) {
      expect(trustedImageUrl(url, e)).toBe(false);
    }
    expect(
      trustedImageUrl('https://media.example.com/x.png', { ...e, R2_PUBLIC_URL: undefined }),
    ).toBe(false);
  });
});
