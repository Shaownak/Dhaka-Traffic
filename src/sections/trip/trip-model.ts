/* =====================================================================
   TRIP MODEL — routing over the network, by hour and day type

   No DOM, no Three, no d3. It takes a graph and an hour and returns routes,
   which is what makes it testable. The only thing it knows about the world is
   that a road's speed depends on the hour and on whether people are commuting.
   ===================================================================== */
import { HOURLY_SPEED_KMH } from '../../data/traffic';
import { PLACES, ROADS, WEEKEND_DAYS, WEEKEND_RELIEF, type Road } from '../../data/network';
import measured from '../../data/measured/network-times.json';

interface MeasuredRoad {
  km: number | null;
  freeMinutes: number | null;
  working: (number | null)[];
  weekend: (number | null)[];
}

/**
 * Collected journey times, keyed "a|b". Empty until a collection run has
 * happened, in which case every road falls back to its modeled speed.
 * A road is used only if it has a value for the exact hour and day type
 * asked for — a half-collected road does not get to guess.
 */
const measuredRoads = (measured as { roads?: Record<string, MeasuredRoad> }).roads ?? {};

export interface Provenance {
  /** Roads on this route whose time came from collected data. */
  measured: number;
  /** Roads still using the modeled speed. */
  modeled: number;
}

/** True once any road has collected times. */
export function hasMeasuredTimes(): boolean {
  return Object.keys(measuredRoads).length > 0;
}

function measuredMinutes(road: Road, hour: number, dayType: DayType): number | null {
  const entry = measuredRoads[`${road.a}|${road.b}`] ?? measuredRoads[`${road.b}|${road.a}`];
  if (!entry) return null;
  const series = dayType === 'weekend' ? entry.weekend : entry.working;
  const value = series?.[((hour % 24) + 24) % 24];
  return typeof value === 'number' ? value : null;
}

export type DayType = 'working' | 'weekend';

export interface Leg {
  from: string;
  to: string;
  via: string;
  km: number;
  minutes: number;
  kmh: number;
  /** Whether this leg used a collected time rather than a modeled speed. */
  measured: boolean;
}

export interface Route {
  /** Place ids, origin first. */
  path: string[];
  legs: Leg[];
  minutes: number;
  km: number;
  /** The same route with no traffic at all. */
  freeFlowMinutes: number;
  /** minutes − freeFlowMinutes: the congestion, isolated. */
  delayMinutes: number;
  /** How much of this route rests on collected data. */
  provenance: Provenance;
}

export interface DeparturePoint {
  hour: number;
  minutes: number;
}

const byId = new Map(PLACES.map((p) => [p.id, p]));

/** Adjacency, built once. Roads are two-way. */
const adjacency = new Map<string, { to: string; road: Road }[]>();
for (const road of ROADS) {
  if (!adjacency.has(road.a)) adjacency.set(road.a, []);
  if (!adjacency.has(road.b)) adjacency.set(road.b, []);
  adjacency.get(road.a)!.push({ to: road.b, road });
  adjacency.get(road.b)!.push({ to: road.a, road });
}

export function placeName(id: string): string {
  return byId.get(id)?.name ?? id;
}

export function dayTypeOf(date: Date): DayType {
  return WEEKEND_DAYS.has(date.getDay()) ? 'weekend' : 'working';
}

/**
 * How fast a road runs at a given hour.
 *
 * The city-wide hourly curve sets the shape and the road's own peak and
 * free-flow speeds set the range — the same rule the street simulation uses, so
 * the two cannot tell different stories. On a weekend the congestion is scaled
 * back by the relief factor for that hour rather than removed, because the
 * roads do not empty, they only stop being commuted on.
 */
export function roadSpeed(road: Road, hour: number, dayType: DayType): number {
  const h = ((hour % 24) + 24) % 24;
  const day = HOURLY_SPEED_KMH[h] ?? HOURLY_SPEED_KMH[0]!;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of HOURLY_SPEED_KMH) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  // 0 at the worst hour of the day, 1 at the best
  const t = hi === lo ? 1 : (day - lo) / (hi - lo);

  if (dayType === 'weekend') {
    // congestion is what sits between free-flow and peak; keep only part of it
    const relief = WEEKEND_RELIEF[h] ?? 1;
    const congestion = (1 - t) * relief;
    return road.freeKmh - (road.freeKmh - road.peakKmh) * congestion;
  }
  return road.peakKmh + (road.freeKmh - road.peakKmh) * t;
}

function legFor(road: Road, from: string, hour: number, dayType: DayType): Leg {
  // A collected time wins outright: it already accounts for junctions, signals
  // and everything else a speed times a distance cannot.
  const collected = measuredMinutes(road, hour, dayType);
  const minutes = collected ?? (road.km / roadSpeed(road, hour, dayType)) * 60;
  return {
    from,
    to: road.a === from ? road.b : road.a,
    via: road.via ?? '',
    km: road.km,
    kmh: (road.km / minutes) * 60,
    minutes,
    measured: collected !== null,
  };
}

function routeFrom(path: string[], hour: number, dayType: DayType): Route {
  const legs: Leg[] = [];
  let minutes = 0;
  let km = 0;
  let freeFlowMinutes = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i]!;
    const to = path[i + 1]!;
    const edge = adjacency.get(from)?.find((e) => e.to === to);
    if (!edge) continue;
    const leg = legFor(edge.road, from, hour, dayType);
    legs.push(leg);
    minutes += leg.minutes;
    km += leg.km;
    freeFlowMinutes += (edge.road.km / edge.road.freeKmh) * 60;
  }

  return {
    path,
    legs,
    minutes,
    km,
    freeFlowMinutes,
    delayMinutes: minutes - freeFlowMinutes,
    provenance: {
      measured: legs.filter((l) => l.measured).length,
      modeled: legs.filter((l) => !l.measured).length,
    },
  };
}

/** Dijkstra, weighted by travel time at this hour. */
export function fastestRoute(from: string, to: string, hour: number, dayType: DayType): Route | null {
  if (from === to || !byId.has(from) || !byId.has(to)) return null;

  const best = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const seen = new Set<string>();

  for (;;) {
    // small graph, so a linear scan is cheaper than a heap
    let node: string | null = null;
    let nodeCost = Infinity;
    for (const [id, cost] of best) {
      if (!seen.has(id) && cost < nodeCost) {
        node = id;
        nodeCost = cost;
      }
    }
    if (node === null) break;
    if (node === to) break;
    seen.add(node);

    for (const edge of adjacency.get(node) ?? []) {
      if (seen.has(edge.to)) continue;
      const cost = nodeCost + legFor(edge.road, node, hour, dayType).minutes;
      if (cost < (best.get(edge.to) ?? Infinity)) {
        best.set(edge.to, cost);
        prev.set(edge.to, node);
      }
    }
  }

  if (!best.has(to)) return null;

  const path: string[] = [to];
  while (path[0] !== from) {
    const step = prev.get(path[0]!);
    if (!step) return null;
    path.unshift(step);
  }
  return routeFrom(path, hour, dayType);
}

/**
 * The alternatives a reader would actually consider.
 *
 * The network is small enough to enumerate every simple path exactly, so these
 * are the real alternatives rather than a heuristic's guess. Paths are capped
 * by length to keep the search bounded and to exclude routes nobody would drive.
 */
export function routeOptions(
  from: string,
  to: string,
  hour: number,
  dayType: DayType,
  limit = 4,
): Route[] {
  if (from === to || !byId.has(from) || !byId.has(to)) return [];

  const found: string[][] = [];
  const maxHops = 9;

  const walk = (node: string, path: string[], visited: Set<string>): void => {
    if (found.length >= 400 || path.length > maxHops) return;
    if (node === to) {
      found.push([...path]);
      return;
    }
    for (const edge of adjacency.get(node) ?? []) {
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      path.push(edge.to);
      walk(edge.to, path, visited);
      path.pop();
      visited.delete(edge.to);
    }
  };
  walk(from, [from], new Set([from]));

  const routes = found
    .map((p) => routeFrom(p, hour, dayType))
    .sort((a, b) => a.minutes - b.minutes);

  // drop routes that merely re-order the same corridors: keep the distinct ones
  const kept: Route[] = [];
  for (const route of routes) {
    if (kept.length >= limit) break;
    const overlaps = kept.some((k) => {
      const shared = route.path.filter((p) => k.path.includes(p)).length;
      return shared / Math.max(route.path.length, k.path.length) > 0.8;
    });
    if (!overlaps) kept.push(route);
  }
  return kept;
}

/** The fastest journey time for every departure hour in a window. */
export function departureCurve(
  from: string,
  to: string,
  fromHour: number,
  toHour: number,
  dayType: DayType,
): DeparturePoint[] {
  const points: DeparturePoint[] = [];
  for (let h = fromHour; h <= toHour; h++) {
    const route = fastestRoute(from, to, h % 24, dayType);
    if (route) points.push({ hour: h % 24, minutes: route.minutes });
  }
  return points;
}

/** The hour in the window with the shortest journey. */
export function bestDeparture(points: readonly DeparturePoint[]): DeparturePoint | null {
  if (!points.length) return null;
  return points.reduce((a, b) => (b.minutes < a.minutes ? b : a));
}
