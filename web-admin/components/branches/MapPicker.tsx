'use client';

import 'leaflet/dist/leaflet.css';
import type { Map as LeafletMap, Marker } from 'leaflet';
import { useEffect, useRef } from 'react';
import { isPoint, roundPoint } from '@/lib/map-link';

// OpenStreetMap's own tiles: no API key, fine for an admin's occasional use under its tile
// policy as long as the attribution stays on the map. Darkened in CSS (.map-box) to fit the panel.
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** A map with one draggable pin: click or drag to place it; typed coordinates move it. */
export function MapPicker({
  lat,
  lng,
  onPick,
}: {
  lat: number;
  lng: number;
  onPick: (lat: number, lng: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const pin = useRef<Marker | null>(null);
  const first = useRef({ lat, lng });
  const pick = useRef(onPick);
  useEffect(() => {
    pick.current = onPick;
  }, [onPick]);

  useEffect(() => {
    let gone = false;
    let resize: ResizeObserver | undefined;
    // Leaflet touches `window` on import: load it in the browser only.
    import('leaflet').then((L) => {
      const el = box.current;
      if (gone || !el) return;
      const start = isPoint(first.current.lat, first.current.lng)
        ? first.current
        : { lat: 47.9184, lng: 106.9177 };
      const m = L.map(el).setView([start.lat, start.lng], 15);
      L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(m);
      const p = L.marker([start.lat, start.lng], {
        draggable: true,
        icon: L.divIcon({ className: 'map-pin', iconSize: [18, 18] }),
        title: 'Салбарын байршил',
      }).addTo(m);
      const place = (at: { lat: number; lng: number }) => {
        const r = roundPoint(at);
        p.setLatLng([r.lat, r.lng]);
        pick.current(r.lat, r.lng);
      };
      p.on('dragend', () => place(p.getLatLng()));
      m.on('click', (e) => place(e.latlng));
      // The drawer animates in: re-measure whenever the box changes size.
      resize = new ResizeObserver(() => m.invalidateSize());
      resize.observe(el);
      map.current = m;
      pin.current = p;
    });
    return () => {
      gone = true;
      resize?.disconnect();
      map.current?.remove();
      map.current = null;
      pin.current = null;
    };
  }, []);

  // Typed or pasted coordinates: move the pin there (a pick from the map itself is already there).
  useEffect(() => {
    const p = pin.current;
    if (!p || !isPoint(lat, lng)) return;
    const at = p.getLatLng();
    if (at.lat === lat && at.lng === lng) return;
    p.setLatLng([lat, lng]);
    map.current?.panTo([lat, lng]);
  }, [lat, lng]);

  return (
    <div
      ref={box}
      className="map-box isolate h-60 overflow-hidden rounded-card border border-hairline bg-surface"
      aria-label="Газрын зураг: салбарын байршлыг дарж эсвэл зүүг чирж сонгоно"
      role="application"
    />
  );
}
