/* =====================================================================
   CONFIDENCE — how much weight this estimate can carry

   Separate from reliability, and the distinction is worth stating because the
   two get conflated constantly:

     RELIABILITY  is about the WORLD. A route through Mohakhali at six is
                  unreliable because the traffic genuinely varies.
     CONFIDENCE   is about OUR KNOWLEDGE. A route can be perfectly predictable
                  and still carry low confidence, because nobody has measured
                  it and the number is coming from a model.

   A system that reports only reliability will happily present a modeled guess
   with a tight band as a high-quality answer. This one cannot: as shipped,
   every journey resolves through the modeled baseline, so every journey
   reports LOW confidence, and the interface says why.
   ===================================================================== */
import { TIER_CREDENCE, TIER_LABEL, type TrafficTier } from './hierarchy';
import type { Route } from '../routing/graph';

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface Confidence {
  /** 0-100. */
  score: number;
  level: ConfidenceLevel;
  /** Share of route distance resting on collected data rather than a model. */
  coverage: number;
  /** Total observations behind the route. */
  samples: number;
  /** The weakest tier anywhere on the route. */
  weakestTier: TrafficTier;
  /** Plain statements a reader can act on. Never empty. */
  reasons: string[];
}

/**
 * ⚠ ASSUMPTIONS. Thresholds for turning evidence into a label. They encode a
 * judgement about how much data is enough, not a measurement of it.
 */
export const CONFIDENCE = {
  /** Samples in a cell before its statistic is worth leaning on. */
  samplesForFull: 30,
  /** Collected data older than this has decayed as a description of today. */
  staleAfterHours: 24 * 90,
  /** Score at or above which the answer is called high confidence. */
  highFrom: 70,
  mediumFrom: 45,
  /** A long route accumulates error; this is where the penalty saturates. */
  longRouteKm: 25,
  maxLengthPenalty: 8,
} as const;

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/**
 * Score a route's evidential standing.
 *
 * Starts from a distance-weighted average of tier credence — a long leg on a
 * guess should weigh more than a short one — then adjusts for how many
 * observations sit behind it, how old they are, and how far the journey runs.
 */
export function confidenceFor(route: Route, options?: { weatherKnown?: boolean }): Confidence {
  const reasons: string[] = [];

  if (!route.legs.length) {
    return {
      score: 0,
      level: 'LOW',
      coverage: 0,
      samples: 0,
      weakestTier: 'freeflow',
      reasons: ['No route to assess.'],
    };
  }

  let weightedCredence = 0;
  let measuredKm = 0;
  let samples = 0;
  let totalKm = 0;
  let newestAge: number | null = null;

  for (const leg of route.legs) {
    const km = leg.km > 0 ? leg.km : 0.1;
    totalKm += km;
    weightedCredence += TIER_CREDENCE[leg.tier] * km;
    samples += leg.samples;
    if (leg.tier === 'observed' || leg.tier === 'profile') measuredKm += km;
  }

  const coverage = totalKm > 0 ? measuredKm / totalKm : 0;
  let score = (weightedCredence / totalKm) * 100;

  // Sample depth: a profile built on four observations is not a profile.
  if (coverage > 0) {
    const perLeg = samples / route.legs.length;
    const depth = clamp(perLeg / CONFIDENCE.samplesForFull, 0, 1);
    score *= 0.7 + 0.3 * depth;
    if (perLeg < CONFIDENCE.samplesForFull) {
      reasons.push(
        `Collected data is thin: about ${Math.round(perLeg)} observations per road, `
        + `against ${CONFIDENCE.samplesForFull} for a stable spread.`,
      );
    }
  }

  // Recency, when there is anything collected to be stale. The oldest leg
  // governs: a route is only as current as its least recently measured road.
  const ages = route.legs
    .map((l) => l.ageHours)
    .filter((a): a is number => a !== null);
  if (ages.length) {
    newestAge = Math.max(...ages);
    if (newestAge > CONFIDENCE.staleAfterHours) {
      score *= 0.85;
      reasons.push(
        `The collected data is about ${Math.round(newestAge / 24)} days old; roads and `
        + 'traffic patterns may have changed since.',
      );
    }
  }

  // Length: more road is more chance for something unmodelled.
  const lengthPenalty = clamp(route.km / CONFIDENCE.longRouteKm, 0, 1) * CONFIDENCE.maxLengthPenalty;
  score -= lengthPenalty;

  if (options?.weatherKnown === false) {
    reasons.push('Weather was not available, so no weather effect is included either way.');
  }

  score = Math.round(clamp(score, 0, 100));

  const level: ConfidenceLevel =
    score >= CONFIDENCE.highFrom ? 'HIGH' : score >= CONFIDENCE.mediumFrom ? 'MEDIUM' : 'LOW';

  // The headline reason goes first: what is actually behind these numbers.
  if (coverage === 0) {
    reasons.unshift(
      `No journey times have been collected for this route. The weakest evidence is the `
      + `${TIER_LABEL[route.provenance.weakestTier].toLowerCase()}; these are estimates, not measurements.`,
    );
  } else if (coverage < 1) {
    reasons.unshift(
      `${Math.round(coverage * 100)}% of this route by distance rests on collected journey times; `
      + 'the rest is modeled.',
    );
  } else {
    reasons.unshift('Every leg of this route uses collected journey times.');
  }

  return {
    score,
    level,
    coverage,
    samples,
    weakestTier: route.provenance.weakestTier,
    reasons,
  };
}
