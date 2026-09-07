/* =====================================================================
   THE JOURNEY PLANNER — one orchestrator, used by the page and the API alike

   Everything upstream of this file produces facts; everything downstream
   presents them. The planner is where a request becomes a decision, and it is
   the only place that decision is made — the page does not re-rank, and the
   API does not second-guess. That is what keeps two interfaces from quietly
   giving different answers to the same question.

   The pipeline, in order:

     1  resolve the two ends against the network
     2  resolve the time constraint, working backwards from a deadline if given
     3  enumerate genuinely different routes
     4  cost each at the hour of travel, through the traffic hierarchy
     5  score and rank them against the reader's stated preference
     6  find stops, if asked, ranked by how little they disrupt the journey
     7  attach uncertainty and confidence to every option
     8  label the alternatives by what they actually are
     9  explain the recommendation from the structured result alone

   NO LANGUAGE MODEL PARTICIPATES IN ANY OF THIS. Step 9 is a template over
   numbers that were already settled by step 5. A model may one day reword its
   output; it may never reach back into the ranking.
   ===================================================================== */
import { DEPARTURE_SEARCH, PREFERENCES, STOP_SEARCH, type PreferenceId } from '../../data/intelligence';
import { geocode } from '../geocoding/resolve';
import { confidenceFor, type Confidence } from '../traffic/confidence';
import { osmPlaces } from '../places/provider';
import { findStops, type StopCandidate } from '../optimization/stops';
import {
  assess,
  optimizeDeparture,
  rankRoutes,
  uncertaintyFor,
  type ScoredRoute,
} from '../optimization/scoring';
import {
  dayTypeOf,
  fastestRoute,
  placeName,
  routeGeometry,
  routeOptions,
  type DayType,
  type Route,
} from '../routing/graph';
import {
  JourneyError,
  type ArrivalRange,
  type DepartureAdvice,
  type JourneyOption,
  type JourneyPlan,
  type JourneyRequest,
  type JourneyStop,
  type OptionLabel,
  type ResolvedPlace,
  type TimeRange,
} from './types';

const DEFAULT_DEPART = 17 * 60; // 5 PM: the hour the whole story is about
const hourOf = (minutes: number): number => Math.floor(minutes / 60) % 24;

/* ---------- resolution ---------- */

function resolveEnd(query: string, which: 'ORIGIN' | 'DESTINATION'): ResolvedPlace {
  const result = geocode(query);
  if (!result.match) {
    throw new JourneyError(
      which === 'ORIGIN' ? 'ORIGIN_NOT_FOUND' : 'DESTINATION_NOT_FOUND',
      `Could not find "${query}" on the Dhaka network.`,
      { query },
    );
  }
  const { place, confidence } = result.match;
  const resolved: ResolvedPlace = {
    id: place.id,
    name: place.name,
    lat: place.lat,
    lon: place.lon,
    confidence,
  };
  if (place.name.toLowerCase() !== query.trim().toLowerCase()) resolved.query = query;
  if (result.ambiguous && result.alternatives.length) {
    resolved.alternatives = result.alternatives.map((a) => ({ id: a.place.id, name: a.place.name }));
  }
  return resolved;
}

/* ---------- shaping one option ---------- */

function timeRangeFor(minutes: number, congestion: number): TimeRange {
  const u = uncertaintyFor(minutes, congestion);
  return { expectedMinutes: u.expectedMinutes, bestMinutes: u.bestMinutes, worstMinutes: u.worstMinutes };
}

function arrivalFrom(departAt: number, duration: TimeRange, fixedMinutes = 0): ArrivalRange {
  return {
    expected: departAt + duration.expectedMinutes + fixedMinutes,
    earliest: departAt + duration.bestMinutes + fixedMinutes,
    latest: departAt + duration.worstMinutes + fixedMinutes,
  };
}

function legsOf(route: Route): JourneyOption['legs'] {
  return route.legs.map((l) => ({
    from: placeName(l.from),
    to: placeName(l.to),
    via: l.via,
    km: l.km,
    minutes: l.minutes,
    kmh: l.kmh,
    tier: l.tier,
  }));
}

function directOption(scored: ScoredRoute, departAt: number, index: number): JourneyOption {
  const { route, assessment } = scored;
  const duration = timeRangeFor(route.minutes, assessment.congestion);
  return {
    id: `direct-${index}`,
    labels: [],
    kind: 'direct',
    path: [...route.path],
    legs: legsOf(route),
    km: route.km,
    duration,
    arrival: arrivalFrom(departAt, duration),
    travelMinutes: route.minutes,
    stop: null,
    assessment,
    confidence: confidenceFor(route),
    score: scored.score,
    reasons: [...scored.reasons],
    geometry: routeGeometry(route),
  };
}

/**
 * A journey broken by a stop.
 *
 * The two driving legs are separate routes costed at separate hours, so this
 * assembles a combined view rather than pretending it is one route. Congestion
 * is distance-weighted across both, which is the same rule a single route uses.
 */
function stopOption(candidate: StopCandidate, departAt: number, index: number): JourneyOption {
  const { legToStop, legFromStop } = candidate;
  const combinedKm = legToStop.km + legFromStop.km;

  const a = assess(legToStop);
  const b = assess(legFromStop);
  const congestion = combinedKm > 0
    ? (a.congestion * legToStop.km + b.congestion * legFromStop.km) / combinedKm
    : 0;

  // Uncertainty applies to the driving. Time spent at the stop is a decision,
  // not a risk, so it shifts the whole journey later without widening the band.
  const driving = timeRangeFor(candidate.travelMinutes, congestion);
  const dwell = candidate.departStop - candidate.arriveAtStop;
  const duration: TimeRange = {
    expectedMinutes: driving.expectedMinutes + dwell,
    bestMinutes: driving.bestMinutes + dwell,
    worstMinutes: driving.worstMinutes + dwell,
  };

  const combinedRoute: Route = {
    path: [...legToStop.path, ...legFromStop.path.slice(1)],
    legs: [...legToStop.legs, ...legFromStop.legs],
    minutes: candidate.travelMinutes,
    km: combinedKm,
    freeFlowMinutes: legToStop.freeFlowMinutes + legFromStop.freeFlowMinutes,
    delayMinutes: legToStop.delayMinutes + legFromStop.delayMinutes,
    provenance: {
      measured: legToStop.provenance.measured + legFromStop.provenance.measured,
      modeled: legToStop.provenance.modeled + legFromStop.provenance.modeled,
      tiers: {},
      weakestTier: legToStop.provenance.weakestTier,
    },
  };
  for (const leg of combinedRoute.legs) {
    combinedRoute.provenance.tiers[leg.tier] = (combinedRoute.provenance.tiers[leg.tier] ?? 0) + 1;
  }

  const stop: JourneyStop = {
    id: candidate.place.id,
    name: candidate.place.name,
    kind: candidate.place.kind,
    lat: candidate.place.lat,
    lon: candidate.place.lon,
    viaPlaceId: candidate.viaPlaceId,
    viaPlaceName: placeName(candidate.viaPlaceId),
    accessKm: candidate.accessKm,
    position: candidate.position,
    dwellMinutes: dwell,
    arriveAt: candidate.arriveAtStop,
    departAt: candidate.departStop,
    detourMinutes: candidate.detourMinutes,
    open: candidate.open,
    reasons: [...candidate.reasons],
  };
  if (candidate.place.cuisine) stop.cuisine = candidate.place.cuisine;

  return {
    id: `stop-${index}`,
    labels: [],
    kind: 'with-stop',
    path: combinedRoute.path,
    legs: legsOf(combinedRoute),
    km: combinedKm,
    duration,
    arrival: arrivalFrom(departAt, driving, dwell),
    travelMinutes: candidate.travelMinutes,
    stop,
    assessment: assess(combinedRoute),
    confidence: confidenceFor(combinedRoute),
    score: candidate.score,
    reasons: [...candidate.reasons],
    geometry: [...routeGeometry(legToStop), ...routeGeometry(legFromStop).slice(1)],
  };
}

/* ---------- labelling ----------
   A label is a claim, so each one is awarded by measuring the set rather than
   by assuming the ranking already means it. */
function applyLabels(options: JourneyOption[]): void {
  if (!options.length) return;

  const direct = options.filter((o) => o.kind === 'direct');
  const withStop = options.filter((o) => o.kind === 'with-stop');

  const award = (pool: JourneyOption[], label: OptionLabel, pick: (o: JourneyOption) => number): void => {
    if (!pool.length) return;
    let best = pool[0]!;
    for (const o of pool) if (pick(o) < pick(best)) best = o;
    if (!best.labels.includes(label)) best.labels.push(label);
  };

  award(direct, 'FASTEST', (o) => o.duration.expectedMinutes);
  award(direct, 'SHORTEST', (o) => o.km);
  award(direct, 'MOST_RELIABLE', (o) => -o.assessment.reliability);
  award(direct, 'LEAST_TRAFFIC', (o) => o.assessment.congestion);
  award(withStop, 'BEST_WITH_STOP', (o) => -o.score);

  options[0]!.labels.unshift('RECOMMENDED');
}

/* ---------- departure advice ---------- */

/**
 * Work backwards from a deadline.
 *
 * `overheadMinutes` is time the journey will spend not driving — a meal, most
 * often. It has to be part of the search rather than added afterwards: a
 * deadline search that costs only the driving will happily recommend a
 * departure that arrives on time in theory and three quarters of an hour late
 * in fact, because nobody told it about the stop.
 */
function adviseDeparture(
  originId: string,
  destinationId: string,
  dayType: DayType,
  preference: PreferenceId,
  arriveBy: number,
  overheadMinutes: number,
): DepartureAdvice | null {
  const { options, best } = optimizeDeparture(
    arriveBy,
    // The window has to cover the journey it is searching for. A fixed window
    // silently declares an hour-long dinner impossible rather than looking
    // further back for a departure that accommodates it.
    DEPARTURE_SEARCH.windowMinutes + overheadMinutes,
    DEPARTURE_SEARCH.intervalMinutes,
    DEPARTURE_SEARCH.bufferMinutes,
    (departMinutes) => {
      const ranked = rankRoutes(
        routeOptions(originId, destinationId, hourOf(departMinutes), dayType, 4),
        preference,
      );
      const top = ranked[0];
      if (!top) return null;
      return {
        travelMinutes: top.assessment.uncertainty.expectedMinutes + overheadMinutes,
        reliability: top.assessment.reliability,
        score: top.score,
      };
    },
  );

  if (!best) return null;

  const feasible = options.filter((o) => o.feasible);
  const earliestSensible = Math.min(...feasible.map((o) => o.departAt));
  const latestSafe = Math.max(...feasible.map((o) => o.departAt));

  // The recommended departure's own spread, so the arrival is a range.
  const ranked = rankRoutes(
    routeOptions(originId, destinationId, hourOf(best.departAt), dayType, 4),
    preference,
  );
  const top = ranked[0];
  const driving = top
    ? timeRangeFor(top.route.minutes, top.assessment.congestion)
    : { expectedMinutes: best.travelMinutes, bestMinutes: best.travelMinutes, worstMinutes: best.travelMinutes };

  return {
    recommended: best.departAt,
    earliestSensible,
    latestSafe,
    // the overhead shifts arrival without widening the band
    arrival: arrivalFrom(best.departAt, driving, overheadMinutes),
    bufferMinutes: arriveBy - best.arriveAt,
    options: options.map((o) => ({
      departAt: o.departAt,
      travelMinutes: o.travelMinutes,
      arriveAt: o.arriveAt,
      feasible: o.feasible,
    })),
  };
}

/* ---------- the entry point ---------- */

/**
 * Plan a journey.
 *
 * Async only because the places dataset is fetched on demand; nothing else
 * here touches the network. A request without a stop resolves without ever
 * loading it.
 */
export async function planJourney(request: JourneyRequest): Promise<JourneyPlan> {
  const notices: string[] = [];
  const attribution: string[] = [];

  /* 1. the two ends */
  const origin = resolveEnd(request.origin, 'ORIGIN');
  const destination = resolveEnd(request.destination, 'DESTINATION');
  if (origin.id === destination.id) {
    throw new JourneyError('SAME_PLACE', 'Origin and destination are the same place.');
  }
  for (const end of [origin, destination]) {
    if (end.alternatives?.length) {
      notices.push(
        `"${end.query ?? end.name}" was read as ${end.name}; `
        + `it could also have meant ${end.alternatives.map((a) => a.name).join(' or ')}.`,
      );
    }
  }

  /* 2. when */
  const dayType: DayType = dayTypeOf(request.date);
  const preference: PreferenceId = request.preference ?? 'BALANCED';

  let departure: DepartureAdvice | null = null;
  let departAt = request.departAt ?? DEFAULT_DEPART;

  if (request.arriveBy !== undefined) {
    // The stop is part of the journey, so the deadline search has to pay for it.
    const overhead = request.stop ? request.stop.dwellMinutes : 0;
    departure = adviseDeparture(
      origin.id, destination.id, dayType, preference, request.arriveBy, overhead,
    );
    if (!departure) {
      throw new JourneyError(
        'DEADLINE_UNREACHABLE',
        `No departure in the ${Math.round(DEPARTURE_SEARCH.windowMinutes / 60)} hours before the `
        + 'deadline arrives in time.',
        { arriveBy: request.arriveBy },
      );
    }
    departAt = departure.recommended;
  }

  /* 3-5. routes, costed and ranked */
  const candidates = routeOptions(
    origin.id,
    destination.id,
    hourOf(departAt),
    dayType,
    request.alternatives ?? 4,
  );
  if (!candidates.length) {
    throw new JourneyError('NO_ROUTE', `No route found from ${origin.name} to ${destination.name}.`);
  }
  const ranked = rankRoutes(candidates, preference);
  const options: JourneyOption[] = ranked.map((r, i) => directOption(r, departAt, i));

  if (candidates.length === 1) {
    notices.push('Only one route exists between these two places on this network, so there is nothing to compare it against.');
  }

  /* 6. stops */
  if (request.stop) {
    const loaded = await osmPlaces.load();
    if (!loaded) {
      notices.push('No places dataset is available, so no stop could be suggested. Run scripts/collect-places.mjs to collect one.');
    } else {
      attribution.push(osmPlaces.attribution);
      const direct = ranked[0]!.route;
      const search = findStops(
        origin.id,
        destination.id,
        direct,
        departAt,
        dayType,
        {
          kinds: request.stop.kinds,
          position: request.stop.position,
          dwellMinutes: request.stop.dwellMinutes,
          ...(request.stop.cuisine !== undefined ? { cuisine: request.stop.cuisine } : {}),
          ...(request.stop.requireOpen !== undefined ? { requireOpen: request.stop.requireOpen } : {}),
        },
        request.date,
      );

      if (search.failure === 'none-in-corridor') {
        notices.push(
          `No ${describeKinds(request.stop.kinds)} was found within `
          + `${STOP_SEARCH.maxOffsetKm} km of this route near the point you asked for. `
          + 'Nothing has been substituted.',
        );
      } else if (search.failure === 'none-within-detour') {
        notices.push(
          `Places were found along the route, but every one added more than `
          + `${STOP_SEARCH.maxDetourMinutes} minutes of driving.`,
        );
      } else if (search.failure === 'no-dataset') {
        notices.push('The places dataset could not be read, so no stop was suggested.');
      }

      options.push(...search.candidates.map((c, i) => stopOption(c, departAt, i)));
    }
  }

  /* 7-8. order, label */
  // When a stop was asked for and found, the best journey WITH one is the
  // answer to the question actually asked — a faster direct route is not a
  // better answer to "where can I eat on the way".
  const wantsStop = Boolean(request.stop);
  const hasStopOption = options.some((o) => o.kind === 'with-stop');

  options.sort((a, b) => {
    if (wantsStop && hasStopOption && a.kind !== b.kind) return a.kind === 'with-stop' ? -1 : 1;
    return b.score - a.score;
  });

  // Keep the best stop-free journey in the list even when stops dominate the
  // ranking. Without it the reader is never shown what breaking the journey
  // actually costs them, which is the one comparison they need.
  const trimmed = trimOptions(options, wantsStop && hasStopOption);
  applyLabels(trimmed);

  const recommended = trimmed[0]!;

  /* 9. explain */
  const preferenceLabel = (PREFERENCES.find((p) => p.id === preference) ?? PREFERENCES[0]!).label;
  const explanation = explainPlan(recommended, trimmed.slice(1), preferenceLabel, ranked);

  // The departure card was costed from the best DIRECT route plus the stop's
  // dwell, before any stop was chosen. Now that a journey has actually been
  // selected, the card should describe THAT journey — otherwise the page shows
  // two arrival times a couple of minutes apart for the same trip, and the
  // reader has no way to tell which one to believe.
  if (departure) {
    departure.arrival = recommended.arrival;
    if (request.arriveBy !== undefined) {
      departure.bufferMinutes = request.arriveBy - recommended.arrival.expected;
    }
  }

  // Verify the promise rather than assuming the search kept it. The deadline
  // search costs the best DIRECT route plus the stop's dwell; the journey
  // finally recommended may take a different route, or a detour to reach the
  // stop. If the two disagree the reader is told, not quietly given a plan
  // that misses the deadline it was built around.
  if (request.arriveBy !== undefined && recommended.arrival.expected > request.arriveBy) {
    const late = recommended.arrival.expected - request.arriveBy;
    notices.push(
      `This journey is expected to arrive about ${fmt(late)} after your `
      + `${clockOf(request.arriveBy)} deadline. `
      + (request.stop
        ? 'Shorten the stop, drop it, or leave earlier.'
        : 'Leave earlier, or accept arriving late.'),
    );
  }

  const confidence: Confidence = recommended.confidence;
  if (confidence.level === 'LOW') {
    notices.push(...confidence.reasons.slice(0, 1));
  }

  return {
    origin,
    destination,
    date: isoDate(request.date),
    dayType,
    departAt,
    arriveBy: request.arriveBy ?? null,
    preference,
    recommended,
    alternatives: trimmed.slice(1),
    departure,
    explanation,
    confidence,
    notices,
    attribution,
    generatedAt: new Date().toISOString(),
  };
}

/** How many journeys to return in total, recommendation included. */
const MAX_OPTIONS = 5;

/**
 * Thin the option list to something a reader can actually compare.
 *
 * Two rules beyond "keep the best":
 *
 *   - when stops dominate, one stop-free journey is always kept, so the cost of
 *     breaking the journey is visible;
 *   - no more than two stops sharing the same junction, because a dozen
 *     restaurants reached identically are one choice presented twelve times.
 */
function trimOptions(options: readonly JourneyOption[], keepDirect: boolean): JourneyOption[] {
  const kept: JourneyOption[] = [];
  const perJunction = new Map<string, number>();

  for (const option of options) {
    if (kept.length >= MAX_OPTIONS) break;
    const junction = option.stop?.viaPlaceId;
    if (junction) {
      const used = perJunction.get(junction) ?? 0;
      if (used >= 2) continue;
      perJunction.set(junction, used + 1);
    }
    kept.push(option);
  }

  if (keepDirect && !kept.some((o) => o.kind === 'direct')) {
    const direct = options.find((o) => o.kind === 'direct');
    if (direct) {
      if (kept.length >= MAX_OPTIONS) kept.pop();
      kept.push(direct);
    }
  }
  return kept;
}

function describeKinds(kinds: readonly string[]): string {
  const words = kinds.map((k) => k.replace('_', ' '));
  if (words.length <= 1) return words[0] ?? 'place';
  return `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`;
}

function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fmt(minutes: number): string {
  const m = Math.round(minutes);
  if (m === 1) return 'a minute';
  return m < 60 ? `${m} minutes` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

function clockOf(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60) % 24;
  const mm = total % 60;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(mm).padStart(2, '0')} ${suffix}`;
}

/**
 * The recommendation in sentences, built from the structured plan alone.
 *
 * Every clause traces to a number computed above it. Nothing is inferred and
 * nothing is generated.
 */
function explainPlan(
  best: JourneyOption,
  others: readonly JourneyOption[],
  preferenceLabel: string,
  ranked: readonly ScoredRoute[],
): string {
  const parts: string[] = [];

  if (best.kind === 'with-stop' && best.stop) {
    const s = best.stop;
    // A negative detour is not an error. Because each leg is costed at the hour
    // it is actually driven, a long enough stop can put the second half of the
    // journey past the worst of the peak — so the driving genuinely shortens.
    // Saying "adds -1 minutes" would hide the one insight worth having here.
    const detour =
      s.detourMinutes < -0.5
        ? `actually saves ${fmt(-s.detourMinutes)} of driving, because you rejoin the road after the worst of the traffic`
        : s.detourMinutes <= 0.5
          ? 'adds no extra driving'
          : `adds ${fmt(s.detourMinutes)} of driving`;

    parts.push(
      `${s.name} is the best place to break this journey: it sits `
      + `${Math.round(s.position * 100)}% of the way along the route and ${detour}.`,
    );

    // The comparison the reader is actually making: what does stopping cost?
    const straight = others.find((o) => o.kind === 'direct');
    if (straight) {
      const cost = best.duration.expectedMinutes - straight.duration.expectedMinutes;
      parts.push(
        `Going straight there takes about ${fmt(straight.duration.expectedMinutes)}, so the `
        + `stop costs you ${fmt(cost)} in all — `
        + `${fmt(s.dwellMinutes)} of it time at the table.`,
      );
    }
    parts.push(
      `Arrive there about ${clockOf(s.arriveAt)}, leave at ${clockOf(s.departAt)} after `
      + `${fmt(s.dwellMinutes)}, and reach the destination between `
      + `${clockOf(best.arrival.earliest)} and ${clockOf(best.arrival.latest)}.`,
    );
    if (s.accessKm > 0.15) {
      parts.push(
        `The route is planned via ${s.viaPlaceName}; ${s.name} is about `
        + `${s.accessKm.toFixed(1)} km from that junction, which this network cannot route in detail.`,
      );
    }
    if (s.open === 'unknown') {
      parts.push('OpenStreetMap does not state its opening hours, so whether it is open then is unknown.');
    } else if (s.open === 'closed') {
      parts.push('Its stated opening hours suggest it is closed at that time.');
    }
  } else {
    parts.push(
      `The ${preferenceLabel.toLowerCase()} route runs ${best.km.toFixed(1)} km in about `
      + `${fmt(best.duration.expectedMinutes)}, arriving between `
      + `${clockOf(best.arrival.earliest)} and ${clockOf(best.arrival.latest)}.`,
    );
    const a = best.assessment;
    const traffic = a.level === 'FREE' ? 'clear roads' : `${a.level.toLowerCase()} traffic`;
    parts.push(`Timing is ${a.reliabilityLabel.toLowerCase()}, with ${traffic} overall.`);
    if (a.worstLeg && (a.worstLeg.level === 'HEAVY' || a.worstLeg.level === 'SEVERE')) {
      parts.push(`The slowest stretch is ${a.worstLeg.via}.`);
    }
  }

  const runnerUp = others[0];
  if (runnerUp) {
    const gap = runnerUp.duration.expectedMinutes - best.duration.expectedMinutes;
    if (Math.abs(gap) < 2) {
      parts.push('The next option takes about the same time but scores lower overall.');
    } else if (gap > 0) {
      parts.push(`The next best option is ${fmt(gap)} slower.`);
    } else {
      parts.push(
        `One alternative is ${fmt(-gap)} quicker but scores lower on the criteria you chose.`,
      );
    }
  } else if (ranked.length === 1) {
    parts.push('No alternative route exists between these two places on this network.');
  }

  parts.push(best.confidence.reasons[0] ?? '');
  return parts.filter(Boolean).join(' ');
}

/** The single fastest route, for callers that want only that. */
export function quickestRoute(
  originId: string,
  destinationId: string,
  departAt: number,
  dayType: DayType,
): Route | null {
  return fastestRoute(originId, destinationId, hourOf(departAt), dayType);
}
