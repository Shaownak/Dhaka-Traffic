/* =====================================================================
   STOP OPTIMIZATION — "somewhere good, roughly halfway"

   The naive reading of that request is "find the restaurant nearest the
   midpoint", and it is wrong. The midpoint of a route is a point in space; the
   thing the traveller actually cares about is how much the stop costs them.
   A place 400 m from the midpoint down a road that is jammed at six o'clock is
   a worse stop than one a kilometre further along a corridor that is moving.

   So the objective here is JOURNEY DISRUPTION: route origin to stop and stop
   to destination through the real network at the real hours, add the time
   spent there, and compare against going straight. Position along the route is
   one term among several rather than the whole answer.

   Two honest limitations, both surfaced rather than smoothed over:

     1. The graph routes between junctions, not to doorways. Every stop is
        reached via its nearest junction, and `accessKm` reports how far the
        door is from that junction. It is a real remaining cost, and it is
        shown, not folded silently into the total.

     2. The second leg is costed at the hour the traveller would actually
        rejoin the road — after the drive out and the meal — so a stop that
        pushes departure into the evening peak is charged for it.
   ===================================================================== */
import { PLACES } from '../../data/network';
import { STOP_SEARCH, STOP_WEIGHTS, type StopWeights } from '../../data/intelligence';
import { boundsAround, haversineKm, projectOntoPath, type LatLon } from '../geo';
import { isOpenAt, type OpenState } from '../places/opening-hours';
import { osmPlaces, type PlaceKind, type Poi } from '../places/provider';
import { fastestRoute, routeGeometry, type DayType, type Route } from '../routing/graph';
import { assess, type Assessment } from './scoring';

export interface StopRequest {
  /** Which kinds of place will do. */
  kinds: readonly PlaceKind[];
  /** Where along the route it is wanted: 0.5 is halfway. */
  position: number;
  /** Minutes spent there. */
  dwellMinutes: number;
  /** Matched against the OSM cuisine tag when the reader names one. */
  cuisine?: string;
  /** Drop places KNOWN to be closed. Never drops places with no stated hours. */
  requireOpen?: boolean;
  maxOffsetKm?: number;
  maxDetourMinutes?: number;
  limit?: number;
}

export interface StopCandidate {
  place: Poi;
  /** The junction the router reaches this place through. */
  viaPlaceId: string;
  /** Straight-line distance from that junction to the door. */
  accessKm: number;
  /** Where it falls along the direct route, 0 at origin and 1 at destination. */
  position: number;
  /** Perpendicular distance from the direct route. */
  offsetKm: number;

  legToStop: Route;
  legFromStop: Route;
  /** Driving only, both legs, excluding time spent at the stop. */
  travelMinutes: number;
  /** Extra driving against going straight there. */
  detourMinutes: number;
  /** Driving plus the stop itself. */
  totalMinutes: number;

  /** Minutes after midnight. */
  arriveAtStop: number;
  departStop: number;
  arriveAtDestination: number;

  /** From OSM hours where stated; 'unknown' is the common case. */
  open: OpenState;

  score: number;
  parts: Record<keyof StopWeights, number>;
  reasons: string[];
}

export type StopFailure =
  | 'no-dataset'
  | 'none-in-corridor'
  | 'none-within-detour';

export interface StopSearchResult {
  candidates: StopCandidate[];
  /** Why the list is empty, when it is. Never a fabricated substitute. */
  failure: StopFailure | null;
  /** How many places the corridor filter considered, for the explanation. */
  considered: number;
  attribution: string;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** Map a value to 0-100 across the candidate set, lower being better. */
function scoreLowerBetter(value: number, all: readonly number[]): number {
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  if (hi === lo) return 100;
  return ((hi - value) / (hi - lo)) * 100;
}

/** The graph junction nearest a point, with the distance to it. */
function nearestJunction(point: LatLon): { id: string; km: number } | null {
  let bestId: string | null = null;
  let bestKm = Infinity;
  for (const place of PLACES) {
    const km = haversineKm(point, place);
    if (km < bestKm) {
      bestKm = km;
      bestId = place.id;
    }
  }
  return bestId === null ? null : { id: bestId, km: bestKm };
}

const hourOf = (minutes: number): number => (minutes / 60) % 24;

/**
 * Find the best places to break this journey.
 *
 * `direct` is the journey without a stop; every candidate is measured against
 * it. Returns an empty list with a stated reason rather than a weaker match
 * when nothing qualifies.
 */
export function findStops(
  originId: string,
  destinationId: string,
  direct: Route,
  departMinutes: number,
  dayType: DayType,
  request: StopRequest,
  date: Date,
): StopSearchResult {
  const attribution = osmPlaces.attribution;

  if (!osmPlaces.isReady()) {
    return { candidates: [], failure: 'no-dataset', considered: 0, attribution };
  }

  const maxOffsetKm = request.maxOffsetKm ?? STOP_SEARCH.maxOffsetKm;
  const maxDetourMinutes = request.maxDetourMinutes ?? STOP_SEARCH.maxDetourMinutes;
  const limit = request.limit ?? STOP_SEARCH.limit;
  const wanted = clamp01(request.position);

  /* ---------- 1. everything in the corridor ---------- */
  const geometry = routeGeometry(direct);
  const bounds = boundsAround(geometry, maxOffsetKm);
  if (!bounds || geometry.length < 2) {
    return { candidates: [], failure: 'none-in-corridor', considered: 0, attribution };
  }

  const inBox = osmPlaces.within(bounds, request.kinds);
  const cuisine = request.cuisine?.trim().toLowerCase();

  interface Near {
    place: Poi;
    offsetKm: number;
    position: number;
    via: string;
    accessKm: number;
  }

  const near: Near[] = [];
  for (const place of inBox) {
    if (cuisine && !(place.cuisine ?? '').toLowerCase().includes(cuisine)) continue;

    const projection = projectOntoPath(place, geometry);
    if (!projection || projection.offsetKm > maxOffsetKm) continue;
    if (Math.abs(projection.fraction - wanted) > STOP_SEARCH.positionTolerance) continue;

    const junction = nearestJunction(place);
    if (!junction || junction.km > STOP_SEARCH.maxAccessKm) continue;
    // A stop reached through the origin or destination itself is not a stop.
    if (junction.id === originId || junction.id === destinationId) continue;

    near.push({
      place,
      offsetKm: projection.offsetKm,
      position: projection.fraction,
      via: junction.id,
      accessKm: junction.km,
    });
  }

  if (!near.length) {
    return { candidates: [], failure: 'none-in-corridor', considered: inBox.length, attribution };
  }

  /* ---------- 2. route through each junction, once ----------
     Many places share a junction, and the routing depends only on the
     junction. Costing per junction rather than per place turns hundreds of
     path searches into at most a couple of dozen. */
  interface ViaCost {
    legToStop: Route;
    legFromStop: Route;
    travelMinutes: number;
    arriveAtStop: number;
    departStop: number;
    arriveAtDestination: number;
  }

  const viaCache = new Map<string, ViaCost | null>();

  const costVia = (via: string): ViaCost | null => {
    const cached = viaCache.get(via);
    if (cached !== undefined) return cached;

    const legToStop = fastestRoute(originId, via, hourOf(departMinutes), dayType);
    if (!legToStop) {
      viaCache.set(via, null);
      return null;
    }
    const arriveAtStop = departMinutes + legToStop.minutes;
    const departStop = arriveAtStop + request.dwellMinutes;

    // Costed at the hour they actually rejoin the road, not the hour they set off.
    const legFromStop = fastestRoute(via, destinationId, hourOf(departStop), dayType);
    if (!legFromStop) {
      viaCache.set(via, null);
      return null;
    }

    const cost: ViaCost = {
      legToStop,
      legFromStop,
      travelMinutes: legToStop.minutes + legFromStop.minutes,
      arriveAtStop,
      departStop,
      arriveAtDestination: departStop + legFromStop.minutes,
    };
    viaCache.set(via, cost);
    return cost;
  };

  /* ---------- 3. build candidates ---------- */
  interface Draft extends Near {
    cost: ViaCost;
    detourMinutes: number;
    open: OpenState;
    risk: number;
  }

  const drafts: Draft[] = [];
  const assessmentCache = new Map<string, number>();

  for (const entry of near) {
    const cost = costVia(entry.via);
    if (!cost) continue;

    const detourMinutes = cost.travelMinutes - direct.minutes;
    if (detourMinutes > maxDetourMinutes) continue;

    // Opening hours are checked at the time they would arrive, not now.
    const arrival = new Date(date);
    arrival.setHours(0, 0, 0, 0);
    arrival.setMinutes(cost.arriveAtStop);
    const open = isOpenAt(entry.place.openingHours, arrival);
    if (request.requireOpen && open === 'closed') continue;

    let risk = assessmentCache.get(entry.via) ?? -1;
    if (risk < 0) {
      const a: Assessment = assess(cost.legToStop);
      const b: Assessment = assess(cost.legFromStop);
      risk = (a.risk + b.risk) / 2;
      assessmentCache.set(entry.via, risk);
    }

    drafts.push({ ...entry, cost, detourMinutes, open, risk });
  }

  if (!drafts.length) {
    return { candidates: [], failure: 'none-within-detour', considered: near.length, attribution };
  }

  /* ---------- 4. score ---------- */
  const totals = drafts.map((d) => d.cost.travelMinutes + request.dwellMinutes);
  const detours = drafts.map((d) => d.detourMinutes);
  const risks = drafts.map((d) => d.risk);
  const offsets = drafts.map((d) => Math.abs(d.position - wanted));
  const accesses = drafts.map((d) => d.accessKm);

  const w = STOP_WEIGHTS;
  const scored: StopCandidate[] = drafts.map((d, i) => {
    const parts: Record<keyof StopWeights, number> = {
      efficiency: scoreLowerBetter(totals[i]!, totals),
      detour: scoreLowerBetter(d.detourMinutes, detours),
      trafficRisk: scoreLowerBetter(d.risk, risks),
      position: scoreLowerBetter(Math.abs(d.position - wanted), offsets),
      access: scoreLowerBetter(d.accessKm, accesses),
    };
    const score =
      parts.efficiency * w.efficiency +
      parts.detour * w.detour +
      parts.trafficRisk * w.trafficRisk +
      parts.position * w.position +
      parts.access * w.access;

    return {
      place: d.place,
      viaPlaceId: d.via,
      accessKm: d.accessKm,
      position: d.position,
      offsetKm: d.offsetKm,
      legToStop: d.cost.legToStop,
      legFromStop: d.cost.legFromStop,
      travelMinutes: d.cost.travelMinutes,
      detourMinutes: d.detourMinutes,
      totalMinutes: d.cost.travelMinutes + request.dwellMinutes,
      arriveAtStop: d.cost.arriveAtStop,
      departStop: d.cost.departStop,
      arriveAtDestination: d.cost.arriveAtDestination,
      open: d.open,
      score: Math.round(score * 10) / 10,
      parts,
      reasons: [],
    };
  });

  // Deterministic: equal scores break on name so the order never depends on
  // the order OSM happened to return things in.
  scored.sort((a, b) => (b.score - a.score) || a.place.name.localeCompare(b.place.name));

  const top = scored.slice(0, limit);
  for (const candidate of top) candidate.reasons = reasonsFor(candidate, top, wanted);

  return { candidates: top, failure: null, considered: near.length, attribution };
}

function reasonsFor(
  entry: StopCandidate,
  all: readonly StopCandidate[],
  wanted: number,
): string[] {
  const reasons: string[] = [];
  const leastDetour = Math.min(...all.map((c) => c.detourMinutes));
  const nearestPosition = Math.min(...all.map((c) => Math.abs(c.position - wanted)));
  const shortestWalk = Math.min(...all.map((c) => c.accessKm));

  if (entry.detourMinutes <= leastDetour + 0.01) reasons.push('smallest detour');
  if (Math.abs(entry.position - wanted) <= nearestPosition + 0.001) {
    reasons.push('closest to where you asked');
  }
  if (entry.accessKm <= shortestWalk + 0.01) reasons.push('nearest to the route itself');
  if (entry.detourMinutes <= 0) reasons.push('costs no extra driving');
  if (entry.open === 'open') reasons.push('stated open when you would arrive');

  if (!reasons.length) {
    reasons.push(`${Math.round(entry.detourMinutes)} min of extra driving`);
  }
  return reasons;
}
