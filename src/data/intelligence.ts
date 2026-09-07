/**
 * TUNING CONSTANTS FOR THE ROUTE INTELLIGENCE LAYER
 *
 * Every number the scoring, reliability and uncertainty models depend on lives
 * here rather than inside the algorithms, so a weighting can be argued about
 * without reading code.
 *
 * ⚠ These are ASSUMPTIONS, not measurements. The congestion thresholds follow
 * conventional traffic-engineering bands; the variability model follows the
 * well-established finding that travel-time spread grows faster than
 * congestion itself and is right-skewed. Neither is calibrated against Dhaka
 * observations, because there are none yet. Anything derived from them is
 * reported as modeled, and the page says so.
 */

/** How congested a road is, on a normalized 0–1 scale. */
export type TrafficLevel = 'FREE' | 'LIGHT' | 'MODERATE' | 'HEAVY' | 'SEVERE';

/**
 * Congestion score = 1 − (speed ÷ free-flow speed), clamped to 0–1.
 * A road at half its free-flow speed scores 0.5.
 */
export const CONGESTION_BANDS: readonly { upTo: number; level: TrafficLevel }[] = [
  { upTo: 0.20, level: 'FREE' },
  { upTo: 0.40, level: 'LIGHT' },
  { upTo: 0.60, level: 'MODERATE' },
  { upTo: 0.80, level: 'HEAVY' },
  { upTo: 1.01, level: 'SEVERE' },
];

/**
 * ⚠ ASSUMPTION. Travel-time spread as a fraction of the expected journey.
 *
 * `base` is the irreducible variability of any trip — lights, parking, the
 * walk to the car. `growth` multiplies the square of the congestion score,
 * because a road at 90 percent congestion is far more than twice as erratic as
 * one at 45: once demand approaches capacity, small disturbances produce large
 * delays. `skew` splits the band asymmetrically, since a journey can go
 * catastrophically wrong but cannot finish in negative time.
 */
export const VARIABILITY = {
  base: 0.08,
  growth: 0.45,
  /** Share of the band that falls on the slow side. */
  skew: 0.68,
} as const;

/** Reliability score bands, high to low. */
export const RELIABILITY_BANDS: readonly { from: number; label: string }[] = [
  { from: 90, label: 'Very reliable' },
  { from: 75, label: 'Reliable' },
  { from: 60, label: 'Moderate' },
  { from: 40, label: 'Unreliable' },
  { from: 0, label: 'High risk' },
];

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'SEVERE';

export const RISK_BANDS: readonly { upTo: number; level: RiskLevel }[] = [
  { upTo: 0.25, level: 'LOW' },
  { upTo: 0.50, level: 'MEDIUM' },
  { upTo: 0.75, level: 'HIGH' },
  { upTo: 1.01, level: 'SEVERE' },
];

/**
 * What the reader is optimizing for. Weights within a profile sum to 1.
 *
 * These are preference weightings, not an optimum — there is no objectively
 * correct trade-off between arriving quickly and arriving predictably, which
 * is exactly why the reader gets to choose.
 */
export type PreferenceId = 'BALANCED' | 'FASTEST' | 'MOST_RELIABLE' | 'LOW_TRAFFIC' | 'SHORTEST';

export interface ScoreWeights {
  eta: number;
  reliability: number;
  traffic: number;
  distance: number;
  simplicity: number;
}

/**
 * Some preferences make a literal promise. "Fastest" must return the fastest
 * route, or the control is lying to the reader — and a 60 percent weight does
 * not guarantee that, because the remaining 40 percent can outvote it. Where
 * `strict` is set, that criterion decides outright and the weighted score only
 * breaks ties.
 */
export const PREFERENCES: readonly {
  id: PreferenceId;
  label: string;
  blurb: string;
  weights: ScoreWeights;
  strict?: 'eta' | 'distance';
}[] = [
  {
    id: 'BALANCED',
    label: 'Balanced',
    blurb: 'A sensible compromise between speed, predictability and congestion.',
    weights: { eta: 0.35, reliability: 0.25, traffic: 0.20, distance: 0.10, simplicity: 0.10 },
  },
  {
    id: 'FASTEST',
    label: 'Fastest',
    blurb: 'Shortest expected journey, whatever it costs in predictability.',
    strict: 'eta',
    weights: { eta: 0.60, reliability: 0.15, traffic: 0.15, distance: 0.10, simplicity: 0.00 },
  },
  {
    id: 'MOST_RELIABLE',
    label: 'Most reliable',
    blurb: 'The route least likely to surprise you, even if it is not the quickest.',
    weights: { eta: 0.20, reliability: 0.45, traffic: 0.25, distance: 0.10, simplicity: 0.00 },
  },
  {
    id: 'LOW_TRAFFIC',
    label: 'Least traffic',
    blurb: 'Avoids the worst congestion, accepting a longer way around.',
    weights: { eta: 0.20, reliability: 0.20, traffic: 0.50, distance: 0.10, simplicity: 0.00 },
  },
  {
    id: 'SHORTEST',
    label: 'Shortest',
    blurb: 'Fewest kilometers, which is not the same as the least time.',
    strict: 'distance',
    weights: { eta: 0.15, reliability: 0.15, traffic: 0.10, distance: 0.60, simplicity: 0.00 },
  },
];

/* =====================================================================
   STOPS — breaking a journey without wrecking it
   ===================================================================== */

export interface StopWeights {
  /** Total journey time including the stop, against the best candidate. */
  efficiency: number;
  /** Extra driving compared with going straight there. */
  detour: number;
  /** Congestion and spread on the two legs the stop creates. */
  trafficRisk: number;
  /** How near the stop falls to where the reader asked for it. */
  position: number;
  /** How far the door is from the junction the router can actually reach. */
  access: number;
}

/**
 * ⚠ PREFERENCE, not an optimum. There is no correct exchange rate between
 * five extra minutes of driving and a stop that sits where you wanted it.
 *
 * Note what is ABSENT: there is no quality term. OpenStreetMap carries no
 * ratings, so a quality weight could only be fed by something invented, or by
 * a proxy like "has a website" that measures how thoroughly a volunteer
 * mapped the place rather than how good it is. Ranking on journey disruption
 * is honest because we compute it ourselves and can show the arithmetic.
 */
export const STOP_WEIGHTS: StopWeights = {
  efficiency: 0.40,
  detour: 0.20,
  trafficRisk: 0.15,
  position: 0.15,
  access: 0.10,
};

export const STOP_SEARCH = {
  /** How far off the route a place may sit and still count as "on the way". */
  maxOffsetKm: 2.0,
  /** How far from the requested position along the route to look. */
  positionTolerance: 0.30,
  /** Extra driving beyond which a stop stops being a detour and becomes a trip. */
  maxDetourMinutes: 25,
  /** Default time spent at the stop when the reader does not say. */
  dwellMinutes: 45,
  /** How many to return. */
  limit: 5,
  /**
   * The graph routes between junctions, not to doorways. A place further than
   * this from its nearest junction is not really on this network and is
   * dropped rather than quietly costed as if it were.
   */
  maxAccessKm: 2.5,
} as const;

/** Departure search when the reader gives an arrival deadline instead. */
export const DEPARTURE_SEARCH = {
  /** How far before the deadline to start looking. */
  windowMinutes: 150,
  /** Granularity of the candidate departures. */
  intervalMinutes: 15,
  /**
   * Arrive this many minutes before the deadline, so a journey landing at
   * exactly the deadline is not offered as comfortable.
   */
  bufferMinutes: 10,
} as const;
