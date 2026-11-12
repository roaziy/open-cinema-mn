import { Asset } from 'expo-asset';
import { useEffect, useState } from 'react';
import * as THREE from 'three';

const warn = (what: string, e?: unknown) => {
  if (__DEV__) console.warn(`[seat-view] carpet texture: ${what}`, e ? String(e) : '');
};

const CARPET = require('../../../assets/models/rooms/carpet.jpg') as number;

/**
 * The standard room's carpet pattern (one 512 px JPEG, tiled by the carpet module's UVs), loaded
 * the way the screen texture is: expo-asset to a local file, then the patched TextureLoader.
 * Null until loaded, when `enabled` is false, or on any failure: the carpet then keeps its flat
 * colour.
 */
export function useCarpetTexture(enabled: boolean): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let loaded: THREE.Texture | null = null;
    Asset.fromModule(CARPET)
      .downloadAsync()
      .then((asset) => {
        const uri = asset.localUri ?? asset.uri;
        if (!uri || cancelled) return;
        new THREE.TextureLoader().load(
          uri,
          (t) => {
            if (cancelled) {
              t.dispose();
              return;
            }
            t.colorSpace = THREE.SRGBColorSpace;
            loaded = t;
            setTexture(t);
          },
          undefined,
          (e) => warn('decode failed', e),
        );
      })
      .catch((e) => warn('load failed', e));
    return () => {
      cancelled = true;
      loaded?.dispose();
      setTexture(null);
    };
  }, [enabled]);
  return enabled ? texture : null;
}
