/* =====================================================================
   GEOMETRY — distances, projections, and positions along a path

   Pure arithmetic on coordinates. No data, no network, no DOM.

   Everything here works in a local planar approximation rather than on the
   sphere. Across greater Dhaka — roughly 30 km by 30 km at 23.8° north — the
   error from flattening is well under a tenth of a percent, far smaller than
   the uncertainty in the road distances themselves. Using spherical
   trigonometry for the projections would be false precision.
   ===================================================================== */

export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

const EARTH_KM = 6371.0088;
const DEG = Math.PI / 180;

/** Latitude the planar approximation is anchored at: central Dhaka. */
const ANCHOR_LAT = 23.78;
const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON = 111.32 * Math.cos(ANCHOR_LAT * DEG);

/** True great-circle distance, used wherever the number is reported to a reader. */
export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

export interface Plane {
  /** Kilometres east of the anchor meridian. */
  x: number;
  /** Kilometres north of the equator, scaled. */
  y: number;
}

export function toPlane(p: LatLon): Plane {
  return { x: p.lon * KM_PER_DEG_LON, y: p.lat * KM_PER_DEG_LAT };
}

/** Total length of a polyline. */
export function pathLengthKm(path: readonly LatLon[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += haversineKm(path[i - 1]!, path[i]!);
  return total;
}

export interface SegmentHit {
  /** Perpendicular distance from the point to the segment, in km. */
  km: number;
  /** Where the foot of the perpendicular falls, 0 at the start and 1 at the end. */
  t: number;
}

/**
 * Distance from a point to a line segment, clamped to the segment's ends —
 * so a restaurant beyond the end of a road measures to that end, not to an
 * imaginary continuation of it.
 */
export function pointToSegmentKm(p: LatLon, a: LatLon, b: LatLon): SegmentHit {
  const pp = toPlane(p);
  const pa = toPlane(a);
  const pb = toPlane(b);
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) return { km: haversineKm(p, a), t: 0 };

  const raw = ((pp.x - pa.x) * dx + (pp.y - pa.y) * dy) / lengthSq;
  const t = Math.max(0, Math.min(1, raw));
  const foot = { x: pa.x + t * dx, y: pa.y + t * dy };
  const km = Math.hypot(pp.x - foot.x, pp.y - foot.y);
  return { km, t };
}

export interface PathProjection {
  /** Perpendicular distance from the point to the nearest part of the path. */
  offsetKm: number;
  /** How far along the path the nearest point falls, 0 at origin and 1 at destination. */
  fraction: number;
  /** Distance travelled along the path to reach that point. */
  alongKm: number;
  /** Which segment the nearest point lies on. */
  segment: number;
}

/**
 * Where a point sits relative to a route.
 *
 * This is what makes "roughly halfway" answerable: the corridor search needs
 * both how far off the route a place is and how far along it, and those are
 * different questions with different tolerances.
 */
export function projectOntoPath(p: LatLon, path: readonly LatLon[]): PathProjection | null {
  if (path.length < 2) return null;

  const cumulative: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    cumulative.push(cumulative[i - 1]! + haversineKm(path[i - 1]!, path[i]!));
  }
  const total = cumulative[cumulative.length - 1]!;
  if (total === 0) return null;

  let best: PathProjection | null = null;
  for (let i = 0; i < path.length - 1; i++) {
    const hit = pointToSegmentKm(p, path[i]!, path[i + 1]!);
    if (best !== null && hit.km >= best.offsetKm) continue;
    const segmentKm = cumulative[i + 1]! - cumulative[i]!;
    const alongKm = cumulative[i]! + hit.t * segmentKm;
    best = { offsetKm: hit.km, fraction: alongKm / total, alongKm, segment: i };
  }
  return best;
}

/** The coordinate a given fraction of the way along a path. */
export function pointAtFraction(path: readonly LatLon[], fraction: number): LatLon | null {
  if (path.length === 0) return null;
  if (path.length === 1) return path[0]!;

  const total = pathLengthKm(path);
  if (total === 0) return path[0]!;

  const target = Math.max(0, Math.min(1, fraction)) * total;
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const step = haversineKm(path[i - 1]!, path[i]!);
    if (walked + step >= target) {
      const t = step === 0 ? 0 : (target - walked) / step;
      const a = path[i - 1]!;
      const b = path[i]!;
      return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
    }
    walked += step;
  }
  return path[path.length - 1]!;
}

/** A bounding box grown by a margin in kilometres, for cheap spatial prefiltering. */
export function boundsAround(path: readonly LatLon[], marginKm: number): {
  south: number; west: number; north: number; east: number;
} | null {
  if (!path.length) return null;
  let south = Infinity; let north = -Infinity;
  let west = Infinity; let east = -Infinity;
  for (const p of path) {
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
    if (p.lon < west) west = p.lon;
    if (p.lon > east) east = p.lon;
  }
  return {
    south: south - marginKm / KM_PER_DEG_LAT,
    north: north + marginKm / KM_PER_DEG_LAT,
    west: west - marginKm / KM_PER_DEG_LON,
    east: east + marginKm / KM_PER_DEG_LON,
  };
}
