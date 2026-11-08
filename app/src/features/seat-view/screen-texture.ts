import { Asset } from 'expo-asset';
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { coverTransform, type ScreenSource } from './camera-math';

/**
 * Film backdrop/poster as a three texture. expo-asset downloads the remote image to a file;
 * r3f's native TextureLoader hands that local uri to expo-gl (texImage2D { localUri }).
 * Returns null while loading or on any failure, so the screen stays a flat film-tone colour.
 */
export function useScreenTexture(source: ScreenSource, planeAspect: number): THREE.Texture | null {
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
            if (cancelled) {
              t.dispose();
              return;
            }
            const img = t.image as { width: number; height: number };
            const c = coverTransform(img.width / img.height, planeAspect);
            t.repeat.set(c.rx, c.ry);
            t.offset.set(c.ox, c.oy);
            t.colorSpace = THREE.SRGBColorSpace;
            loaded = t;
            setTexture(t);
          },
          undefined,
          () => {},
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      loaded?.dispose();
      setTexture(null);
    };
  }, [url, planeAspect]);

  return url ? texture : null;
}
