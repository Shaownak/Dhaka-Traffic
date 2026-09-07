import { describe, expect, it } from 'vitest';
import {
  boundsAround,
  haversineKm,
  pathLengthKm,
  pointAtFraction,
  pointToSegmentKm,
  projectOntoPath,
  type LatLon,
} from './geo';

const GULSHAN: LatLon = { lat: 23.7806, lon: 90.4143 };
const MIRPUR: LatLon = { lat: 23.8069, lon: 90.3687 };
const MOHAKHALI: LatLon = { lat: 23.7776, lon: 90.4048 };

describe('haversine', () => {
  it('is zero for a point against itself', () => {
    expect(haversineKm(GULSHAN, GULSHAN)).toBe(0);
  });

  it('is symmetric', () => {
    expect(haversineKm(GULSHAN, MIRPUR)).toBeCloseTo(haversineKm(MIRPUR, GULSHAN), 9);
  });

  it('gives a believable distance across Dhaka', () => {
    // Gulshan to Mirpur 10 is about 5 km as the crow flies
    const km = haversineKm(GULSHAN, MIRPUR);
    expect(km).toBeGreaterThan(4);
    expect(km).toBeLessThan(6.5);
  });

  it('matches a known degree of latitude', () => {
    // one degree of latitude is about 110.6 km anywhere
    expect(haversineKm({ lat: 23, lon: 90 }, { lat: 24, lon: 90 })).toBeCloseTo(111.2, 0);
  });
});

describe('point to segment', () => {
  it('is zero for a point on the line', () => {
    const mid = { lat: (GULSHAN.lat + MIRPUR.lat) / 2, lon: (GULSHAN.lon + MIRPUR.lon) / 2 };
    const hit = pointToSegmentKm(mid, GULSHAN, MIRPUR);
    expect(hit.km).toBeLessThan(0.02);
    expect(hit.t).toBeCloseTo(0.5, 2);
  });

  it('clamps past the ends rather than extending the line', () => {
    // a point well beyond Mirpur should measure to Mirpur itself
    const beyond = { lat: 23.9069, lon: 90.2687 };
    const hit = pointToSegmentKm(beyond, GULSHAN, MIRPUR);
    expect(hit.t).toBe(1);
    expect(hit.km).toBeCloseTo(haversineKm(beyond, MIRPUR), 1);
  });

  it('survives a zero-length segment', () => {
    const hit = pointToSegmentKm(MIRPUR, GULSHAN, GULSHAN);
    expect(hit.km).toBeCloseTo(haversineKm(MIRPUR, GULSHAN), 6);
  });
});

describe('projection onto a path', () => {
  const path = [GULSHAN, MOHAKHALI, MIRPUR];

  it('puts the origin at 0 and the destination at 1', () => {
    expect(projectOntoPath(GULSHAN, path)!.fraction).toBeCloseTo(0, 3);
    expect(projectOntoPath(MIRPUR, path)!.fraction).toBeCloseTo(1, 3);
  });

  it('reports how far off the path a point sits', () => {
    const off = { lat: MOHAKHALI.lat + 0.02, lon: MOHAKHALI.lon };
    const hit = projectOntoPath(off, path)!;
    expect(hit.offsetKm).toBeGreaterThan(1.5);
    expect(hit.offsetKm).toBeLessThan(3);
  });

  it('measures along the path, not straight through it', () => {
    // the dog-leg via Mohakhali is longer than the direct line
    expect(pathLengthKm(path)).toBeGreaterThan(haversineKm(GULSHAN, MIRPUR));
  });

  it('returns null for a path too short to have a direction', () => {
    expect(projectOntoPath(GULSHAN, [GULSHAN])).toBeNull();
  });
});

describe('point at fraction', () => {
  const path = [GULSHAN, MOHAKHALI, MIRPUR];

  it('hits the ends exactly', () => {
    expect(pointAtFraction(path, 0)).toEqual(GULSHAN);
    expect(pointAtFraction(path, 1)).toEqual(MIRPUR);
  });

  it('clamps out-of-range fractions instead of extrapolating', () => {
    expect(pointAtFraction(path, -5)).toEqual(GULSHAN);
    expect(pointAtFraction(path, 5)).toEqual(MIRPUR);
  });

  it('round-trips with the projection', () => {
    const half = pointAtFraction(path, 0.5)!;
    expect(projectOntoPath(half, path)!.fraction).toBeCloseTo(0.5, 2);
  });
});

describe('bounds', () => {
  it('contains every point plus the margin', () => {
    const b = boundsAround([GULSHAN, MIRPUR], 2)!;
    expect(b.south).toBeLessThan(Math.min(GULSHAN.lat, MIRPUR.lat));
    expect(b.north).toBeGreaterThan(Math.max(GULSHAN.lat, MIRPUR.lat));
    expect(b.west).toBeLessThan(Math.min(GULSHAN.lon, MIRPUR.lon));
    expect(b.east).toBeGreaterThan(Math.max(GULSHAN.lon, MIRPUR.lon));
  });

  it('grows with the margin', () => {
    const small = boundsAround([GULSHAN], 1)!;
    const big = boundsAround([GULSHAN], 5)!;
    expect(big.north - big.south).toBeGreaterThan(small.north - small.south);
  });

  it('is null for nothing', () => {
    expect(boundsAround([], 1)).toBeNull();
  });
});
