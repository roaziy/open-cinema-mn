import { Asset } from 'expo-asset';
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { coverTransform, type ScreenSource, textureFits } from './camera-math';

const warn = (what: string, e?: unknown) => {
  if (__DEV__) console.warn(`[seat-view] screen texture: ${what}`, e ? String(e) : '');
};

/**
 * Film backdrop/poster as a three texture. expo-asset downloads the remote image to a file;
 * r3f native's patched TextureLoader hands that local uri to expo-gl (texImage2D { localUri }).
 * Returns null while loading, on any failure, or when the image is larger than the GPU allows,
 * so the screen is never left black: it stays the flat film-tone colour.
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
    Asset.fromURI(url)
      .downloadAsync()
      .then((asset) => {
        const uri = asset.localUri;
        if (!uri || cancelled) return;
        new THREE.TextureLoader().load(
          uri,
          (t) => {
            const img = t.image as { width: number; height: number };
            if (cancelled || !textureFits(img.width, img.height, maxTextureSize)) {
              if (!cancelled) warn(`image ${img.width}x${img.height} too large, using flat tone`);
              t.dispose();
              return;
            }
            const c = coverTransform(img.width / img.height, planeAspect);
            t.repeat.set(c.rx, c.ry);
            t.offset.set(c.ox, c.oy);
            t.colorSpace = THREE.SRGBColorSpace;
            loaded = t;
            setTexture(t);
          },
          undefined,
          (e) => warn('decode failed', e),
        );
      })
      .catch((e) => warn('download failed', e));
    return () => {
      cancelled = true;
      loaded?.dispose();
      setTexture(null);
    };
  }, [url, planeAspect, maxTextureSize]);

  return url ? texture : null;
}
