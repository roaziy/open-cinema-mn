import { Asset } from 'expo-asset';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { coverTransform, type ScreenSource } from './camera-math';

const warn = (what: string, e?: unknown) => {
  if (__DEV__) console.warn(`[seat-view] screen texture: ${what}`, e ? String(e) : '');
};

// ponytail: a cinema screen never needs more; also keeps GPU memory small on any phone.
const MAX_SIDE = 2048;

/**
 * Film backdrop/poster as a three texture. expo-asset downloads the remote image to a file, the
 * platform decoder re-encodes it as a JPEG no larger than the GPU allows, and r3f native's patched
 * TextureLoader hands that file to expo-gl.
 *
 * The re-encode is required, not cosmetic: expo-gl decodes files with stb_image, which cannot read
 * WebP (what the admin uploads). It then uploads a null buffer, and a real iPhone GPU crashes on it
 * (the simulator happens not to). Returns null while loading or on any failure, so the screen is
 * never left black: it stays the flat film-tone colour.
 */
export function useScreenTexture(
  source: ScreenSource,
  planeAspect: number,
  maxTextureSize: number,
): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const url = source.kind === 'remote' ? source.url : null;

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let loaded: THREE.Texture | null = null;
    const limit = Math.min(maxTextureSize > 0 ? maxTextureSize : MAX_SIDE, MAX_SIDE);
    (async () => {
      const asset = await Asset.fromURI(url).downloadAsync();
      if (!asset.localUri || cancelled) return;
      let image = await ImageManipulator.manipulate(asset.localUri).renderAsync();
      const longest = Math.max(image.width, image.height);
      if (!(longest > 0)) throw new Error('empty image');
      if (longest > limit) {
        const k = limit / longest;
        image = await ImageManipulator.manipulate(image)
          .resize({ width: Math.round(image.width * k), height: Math.round(image.height * k) })
          .renderAsync();
      }
      const jpeg = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
      if (cancelled) return;
      new THREE.TextureLoader().load(
        jpeg.uri,
        (t) => {
          if (cancelled) {
            t.dispose();
            return;
          }
          const c = coverTransform(jpeg.width / jpeg.height, planeAspect);
          t.repeat.set(c.rx, c.ry);
          t.offset.set(c.ox, c.oy);
          t.colorSpace = THREE.SRGBColorSpace;
          loaded = t;
          setTexture(t);
        },
        undefined,
        (e) => warn('decode failed', e),
      );
    })().catch((e) => warn('load failed', e));
    return () => {
      cancelled = true;
      loaded?.dispose();
      setTexture(null);
    };
  }, [url, planeAspect, maxTextureSize]);

  return url ? texture : null;
}
