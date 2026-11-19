import { describe, expect, it } from 'vitest';
import { parseLocation } from '@/lib/map-link';

describe('parseLocation', () => {
  it('prefers the Google place pin over the map view', () => {
    const url =
      'https://www.google.com/maps/place/Shangri-La/@47.9135,106.9154,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d47.9136123!4d106.9167456!16s';
    expect(parseLocation(url)).toEqual({ lat: 47.913612, lng: 106.916746 });
  });

  it('reads Google map views and query links', () => {
    expect(parseLocation('https://www.google.com/maps/@47.9184,106.9177,15z')).toEqual({
      lat: 47.9184,
      lng: 106.9177,
    });
    expect(parseLocation('https://maps.google.com/?q=47.9184,106.9177')).toEqual({
      lat: 47.9184,
      lng: 106.9177,
    });
    expect(
      parseLocation('https://www.google.com/maps/search/?api=1&query=47.9184%2C106.9177'),
    ).toEqual({ lat: 47.9184, lng: 106.9177 });
  });

  it('reads OpenStreetMap markers before views', () => {
    expect(
      parseLocation('https://www.openstreetmap.org/?mlat=47.9184&mlon=106.9177#map=17/47.9/106.9'),
    ).toEqual({ lat: 47.9184, lng: 106.9177 });
    expect(parseLocation('https://www.openstreetmap.org/#map=17/47.9184/106.9177')).toEqual({
      lat: 47.9184,
      lng: 106.9177,
    });
  });

  it('reads a copied "lat, lng" pair', () => {
    expect(parseLocation(' 47.91845, 106.91772 ')).toEqual({ lat: 47.91845, lng: 106.91772 });
    expect(parseLocation('-33.8568, 151.2153')).toEqual({ lat: -33.8568, lng: 151.2153 });
  });

  it('gives null for short links, place names and impossible points', () => {
    expect(parseLocation('https://maps.app.goo.gl/AbCdEf123')).toBeNull();
    expect(parseLocation('Shangri-La Ulaanbaatar')).toBeNull();
    expect(parseLocation('95, 200')).toBeNull();
    expect(parseLocation('47.9')).toBeNull();
  });
});
