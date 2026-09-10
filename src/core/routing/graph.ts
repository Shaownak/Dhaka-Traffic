/* =====================================================================
   TRIP MODEL — routing over the network, by hour and day type

   No DOM, no Three, no d3. It takes a graph and an hour and returns routes,
   which is what makes it testable. The only thing it knows about the world is
   that a road's speed depends on the hour and on whether people are commuting.
   ===================================================================== */
import { PLACES, ROADS, WEEKEND_DAYS, type Road } from '../../data/network';
import {
  estimateLeg,
  hasProfileData,
  roadSpeed,
  TIER_CREDENCE,
  type DayType,
  type TrafficTier,
} from '../traffic/hierarchy';
import type { LatLon } from '../geo';

// Travel-time estimation belongs to the traffic layer, which owns the source
// hierarchy and knows which tier answered. Routing only assembles the legs.
export { roadSpeed };
export type { DayType };

export interface Provenance {
  /** Roads on this route whose time came from collected data. */
  measured: number;
  /** Roads still using a modeled speed. */
  modeled: number;
  /** How many legs each tier answered for. */
  tiers: Partial<Record<TrafficTier, number>>;
  /** The weakest tier anywhere on the route — the route is only as good as this. */
  weakestTier: TrafficTier;
}

/**
 * True once any road has collected times.
 * @deprecated Prefer `hasProfileData` from the traffic layer; kept because the
 * trip section reads it to decide what to say about provenance.
 */
export function hasMeasuredTimes(): boolean {
  return hasProfileData();
}

export interface Leg {
  from: string;
  to: string;
  via: string;
  km: number;
  minutes: number;
  kmh: number;
  /** The same road with no traffic, for congestion comparison. */
  freeKmh: number;
  /** Whether this leg used a collected time rather than a modeled speed. */
  measured: boolean;
  /** Which tier of the traffic hierarchy produced this leg's time. */
  tier: TrafficTier;
  /** Observations behind it. Zero for modeled tiers. */
  samples: number;
  /** Hours since the newest observation, or null for a modeled tier. */
  ageHours: number | null;
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

/** Which place a road leads to, coming from the other end. */
function otherEnd(road: Road, from: string): string {
  return road.a === from ? road.b : road.a;
}

function legFor(road: Road, from: string, hour: number, dayType: DayType): Leg {
  // The traffic layer decides which source answers; routing does not care how
  // the number was obtained, only that the tier comes back with it.
  const estimate = estimateLeg(road, hour, dayType);
  return {
    from,
    to: otherEnd(road, from),
    via: road.via ?? '',
    km: road.km,
    kmh: estimate.kmh,
    freeKmh: road.freeKmh,
    minutes: estimate.minutes,
    measured: estimate.tier === 'observed' || estimate.tier === 'profile',
    tier: estimate.tier,
    samples: estimate.samples,
    ageHours: estimate.ageHours,
  };
}

/**
 * Cost a path, advancing the clock as it goes.
 *
 * Each leg is priced at the hour the traveller actually reaches it, not at the
 * hour they set off. On a cross-city trip that spans the evening peak the
 * difference is large, and pricing the whole route at the departure hour
 * produced a visible absurdity: a journey broken by a 45-minute meal could come
 * out FASTER than the same journey driven straight through, because only the
 * former had its later legs costed at a later — and cheaper — hour.
 */
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
    const leg = legFor(edge.road, from, hour + minutes / 60, dayType);
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
    provenance: provenanceOf(legs),
  };
}

/** Tally which tiers answered, and find the weakest link. */
function provenanceOf(legs: readonly Leg[]): Provenance {
  const tiers: Partial<Record<TrafficTier, number>> = {};
  let weakestTier: TrafficTier = 'observed';
  for (const leg of legs) {
    tiers[leg.tier] = (tiers[leg.tier] ?? 0) + 1;
    // credence descends with tier quality, so the smallest is the weakest
    if (TIER_CREDENCE[leg.tier] < TIER_CREDENCE[weakestTier]) weakestTier = leg.tier;
  }
  return {
    measured: legs.filter((l) => l.measured).length,
    modeled: legs.filter((l) => !l.measured).length,
    tiers,
    weakestTier: legs.length ? weakestTier : 'freeflow',
  };
}

/** Dijkstra, weighted by travel time at this hour. */
export function fastestRoute(from: string, to: string, hour: number, dayType: DayType): Route | null {
  const path = shortestPath(from, to, hour, dayType);
  return path ? routeFrom(path, hour, dayType) : null;
}

/**
 * Dijkstra, weighted by travel time at this hour, with parts of the graph
 * optionally closed off.
 *
 * The exclusions are what Yen's algorithm needs to find the second-best route:
 * ban the roads the best route used and ask again. Nothing else uses them.
 */
function shortestPath(
  from: string,
  to: string,
  hour: number,
  dayType: DayType,
  bannedNodes?: ReadonlySet<string>,
  bannedEdges?: ReadonlySet<string>,
): string[] | null {
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
      if (bannedNodes?.has(edge.to)) continue;
      if (bannedEdges?.has(edgeKey(node, edge.to))) continue;
      // Time-dependent: the road is priced at the hour this leg is reached.
      // Valid for Dijkstra because arriving earlier never makes you arrive
      // later — the network has no scheduled services to miss.
      const cost = nodeCost + legFor(edge.road, node, hour + nodeCost / 60, dayType).minutes;
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
  return path;
}

const edgeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * The k quickest genuinely different routes, by Yen's algorithm.
 *
 * This replaced an exhaustive depth-first enumeration that was capped at nine
 * hops. The cap was an absolute one, and that quietly broke the longest trips:
 * an alternative to an eight-hop route needs nine or ten hops, so exactly the
 * journeys where a reader most wants a choice were the ones served a single
 * option. Yen's is bounded by k rather than by path length, so a cross-city
 * trip gets the same number of alternatives as a short one.
 *
 * It also scales. The exhaustive search was only viable because this graph has
 * 28 nodes; k-shortest-paths stays affordable as the network grows.
 */
export function routeOptions(
  from: string,
  to: string,
  hour: number,
  dayType: DayType,
  limit = 4,
): Route[] {
  if (from === to || !byId.has(from) || !byId.has(to)) return [];

  // Ask for more than we will show: the near-duplicate filter below needs
  // spare candidates to choose distinct routes from.
  const paths = kShortestPaths(from, to, hour, dayType, Math.max(limit * 3, 8));
  const routes = paths
    .map((p) => routeFrom(p, hour, dayType))
    .sort((a, b) => a.minutes - b.minutes);

  return distinctRoutes(routes, limit);
}

/** Yen's algorithm: k loopless shortest paths, quickest first. */
function kShortestPaths(
  from: string,
  to: string,
  hour: number,
  dayType: DayType,
  k: number,
): string[][] {
  const first = shortestPath(from, to, hour, dayType);
  if (!first) return [];

  const accepted: string[][] = [first];
  /** Candidates found but not yet promoted, keyed by path so duplicates collapse. */
  const candidates = new Map<string, { path: string[]; minutes: number }>();

  const costOf = (path: string[]): number => routeFrom(path, hour, dayType).minutes;

  while (accepted.length < k) {
    const previous = accepted[accepted.length - 1]!;

    for (let i = 0; i < previous.length - 1; i++) {
      const spurNode = previous[i]!;
      const rootPath = previous.slice(0, i + 1);

      // Ban the next step of every accepted path that starts the same way, so
      // the spur search is forced to find something new.
      const bannedEdges = new Set<string>();
      for (const path of accepted) {
        if (path.length > i + 1 && sameStart(path, rootPath)) {
          bannedEdges.add(edgeKey(path[i]!, path[i + 1]!));
        }
      }
      // The root may not be revisited, or the path would loop.
      const bannedNodes = new Set(rootPath.slice(0, -1));

      const spurHour = hour + routeFrom(rootPath, hour, dayType).minutes / 60;
      const spur = shortestPath(spurNode, to, spurHour, dayType, bannedNodes, bannedEdges);
      if (!spur) continue;

      const total = [...rootPath.slice(0, -1), ...spur];
      const key = total.join('>');
      if (accepted.some((p) => p.join('>') === key)) continue;
      if (!candidates.has(key)) candidates.set(key, { path: total, minutes: costOf(total) });
    }

    if (candidates.size === 0) break;

    let bestKey = '';
    let bestCost = Infinity;
    for (const [key, entry] of candidates) {
      // ties break on the path string so the result never depends on Map order
      if (entry.minutes < bestCost || (entry.minutes === bestCost && key < bestKey)) {
        bestCost = entry.minutes;
        bestKey = key;
      }
    }
    accepted.push(candidates.get(bestKey)!.path);
    candidates.delete(bestKey);
  }

  return accepted;
}

function sameStart(path: readonly string[], root: readonly string[]): boolean {
  if (path.length < root.length) return false;
  for (let i = 0; i < root.length; i++) if (path[i] !== root[i]) return false;
  return true;
}

/** The roads a route uses, as undirected keys. */
function edgeSet(route: Route): Set<string> {
  const edges = new Set<string>();
  for (let i = 0; i < route.path.length - 1; i++) {
    edges.add([route.path[i]!, route.path[i + 1]!].sort().join('|'));
  }
  return edges;
}

/** Share of roads two routes have in common, 0 for disjoint and 1 for identical. */
function edgeSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const e of a) if (b.has(e)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * Thin a ranked list down to genuinely different ways of making the trip.
 *
 * Similarity is measured over ROADS USED, not places visited. Comparing places
 * was the earlier approach and it was wrong: every route between two points
 * shares both endpoints and usually most of the spine, so a long trip could
 * collapse to a single "alternative" even when real choices existed. Two routes
 * that diverge for six kilometres in the middle are different routes to the
 * driver, however many junction names they have in common.
 *
 * Thresholds relax over successive passes rather than being fixed, so a reader
 * on a corridor with few genuine options still gets alternatives — near
 * duplicates, but honestly ordered — instead of a list of one.
 */
function distinctRoutes(routes: readonly Route[], limit: number): Route[] {
  const kept: Route[] = [];
  const keptEdges: Set<string>[] = [];
  const edges = routes.map(edgeSet);
  const taken = new Set<number>();

  for (const threshold of [0.6, 0.8, 0.95, 1.01]) {
    for (let i = 0; i < routes.length && kept.length < limit; i++) {
      if (taken.has(i)) continue;
      const mine = edges[i]!;
      // an exactly identical road set is never a second option
      if (keptEdges.some((k) => edgeSimilarity(mine, k) >= 1)) {
        taken.add(i);
        continue;
      }
      if (keptEdges.some((k) => edgeSimilarity(mine, k) > threshold)) continue;
      kept.push(routes[i]!);
      keptEdges.push(mine);
      taken.add(i);
    }
    if (kept.length >= limit) break;
  }
  return kept;
}

/**
 * Coordinates for drawing a route.
 *
 * ⚠ These are the straight lines between junctions, not the shape of the road.
 * The network is a graph of places, so a leg that curves in reality is drawn as
 * a chord. Real geometry needs a routing engine with the road centrelines —
 * which is exactly what the RoutingProvider abstraction exists to allow.
 */
export function routeGeometry(route: Route): LatLon[] {
  const points: LatLon[] = [];
  for (const id of route.path) {
    const place = byId.get(id);
    if (place) points.push({ lat: place.lat, lon: place.lon });
  }
  return points;
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
