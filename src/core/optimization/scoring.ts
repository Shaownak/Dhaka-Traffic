/* =====================================================================
   ROUTE INTELLIGENCE — congestion, uncertainty, reliability, risk, scoring

   Pure functions over a finished Route. Nothing here talks to the network, the
   DOM, or a language model.

   The division of labour matters: this file DECIDES, and it decides the same
   way every time from the same inputs. The explanation layer only describes
   what was decided. A language model, if one is ever added, may reword the
   description — it may never pick the route.
   ===================================================================== */
import {
  CONGESTION_BANDS,
  PREFERENCES,
  RELIABILITY_BANDS,
  RISK_BANDS,
  VARIABILITY,
  type PreferenceId,
  type RiskLevel,
  type ScoreWeights,
  type TrafficLevel,
} from '../../data/intelligence';
import type { Route } from '../routing/graph';

export interface Uncertainty {
  bestMinutes: number;
  expectedMinutes: number;
  worstMinutes: number;
}

export interface Assessment {
  congestion: number;
  level: TrafficLevel;
  uncertainty: Uncertainty;
  reliability: number;
  reliabilityLabel: string;
  risk: number;
  riskLevel: RiskLevel;
  /** The slowest leg on the route, which is usually what a reader wants named. */
  worstLeg: { via: string; level: TrafficLevel } | null;
  /** Whether any of this rests on collected data. */
  basis: 'measured' | 'modeled' | 'mixed';
}

export interface ScoredRoute {
  route: Route;
  assessment: Assessment;
  /** 0–100, relative to the other candidates in the same comparison. */
  score: number;
  parts: Record<keyof ScoreWeights, number>;
  reasons: string[];
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** 1 − (speed ÷ free-flow speed). A road at half speed scores 0.5. */
export function congestionScore(kmh: number, freeKmh: number): number {
  if (freeKmh <= 0) return 0;
  return clamp01(1 - kmh / freeKmh);
}

export function trafficLevel(congestion: number): TrafficLevel {
  for (const band of CONGESTION_BANDS) {
    if (congestion < band.upTo) return band.level;
  }
  return 'SEVERE';
}

/**
 * Best, expected and worst journey times.
 *
 * The band widens with the square of congestion and leans slow, because a trip
 * can go badly wrong in ways it cannot go right: there is no traffic condition
 * that returns time to you.
 */
export function uncertaintyFor(expectedMinutes: number, congestion: number): Uncertainty {
  const spread = VARIABILITY.base + VARIABILITY.growth * congestion * congestion;
  const slow = spread * VARIABILITY.skew;
  const fast = spread * (1 - VARIABILITY.skew);
  return {
    bestMinutes: expectedMinutes * (1 - fast),
    expectedMinutes,
    worstMinutes: expectedMinutes * (1 + slow),
  };
}

/**
 * How consistently a route performs, 0–100.
 *
 * Derived from how wide its time band is relative to the journey. A trip that
 * might take anywhere from 30 to 60 minutes is unreliable however fast its
 * best case looks.
 */
export function reliabilityFor(u: Uncertainty): number {
  if (u.expectedMinutes <= 0) return 0;
  const spread = (u.worstMinutes - u.bestMinutes) / u.expectedMinutes;
  // a spread of 0 is perfect; 0.6 or worse scores zero
  return Math.round(clamp01(1 - spread / 0.6) * 100);
}

export function reliabilityLabel(score: number): string {
  for (const band of RELIABILITY_BANDS) {
    if (score >= band.from) return band.label;
  }
  return 'High risk';
}

/** Exposure to things going wrong: congestion, spread, and severe stretches. */
export function riskFor(congestion: number, u: Uncertainty, severeLegs: number, legCount: number): number {
  const spread = u.expectedMinutes > 0
    ? (u.worstMinutes - u.bestMinutes) / u.expectedMinutes
    : 0;
  const severeShare = legCount > 0 ? severeLegs / legCount : 0;
  return clamp01(congestion * 0.5 + clamp01(spread / 0.6) * 0.3 + severeShare * 0.2);
}

export function riskLevel(risk: number): RiskLevel {
  for (const band of RISK_BANDS) {
    if (risk < band.upTo) return band.level;
  }
  return 'SEVERE';
}

/** Everything the intelligence layer knows about one route. */
export function assess(route: Route): Assessment {
  // distance-weighted congestion: a slow kilometre counts more than a slow leg
  let weighted = 0;
  let severe = 0;
  let worstLeg: { via: string; level: TrafficLevel } | null = null;
  let worstCongestion = -1;

  for (const leg of route.legs) {
    const legCongestion = leg.freeKmh > 0 ? congestionScore(leg.kmh, leg.freeKmh) : 0;
    weighted += legCongestion * leg.km;
    const level = trafficLevel(legCongestion);
    if (level === 'SEVERE') severe++;
    if (legCongestion > worstCongestion) {
      worstCongestion = legCongestion;
      worstLeg = { via: leg.via || `${leg.from} to ${leg.to}`, level };
    }
  }

  const congestion = route.km > 0 ? clamp01(weighted / route.km) : 0;
  const uncertainty = uncertaintyFor(route.minutes, congestion);
  const reliability = reliabilityFor(uncertainty);
  const risk = riskFor(congestion, uncertainty, severe, route.legs.length);

  const measured = route.provenance.measured;
  const modeled = route.provenance.modeled;

  return {
    congestion,
    level: trafficLevel(congestion),
    uncertainty,
    reliability,
    reliabilityLabel: reliabilityLabel(reliability),
    risk,
    riskLevel: riskLevel(risk),
    worstLeg,
    basis: measured > 0 && modeled > 0 ? 'mixed' : measured > 0 ? 'measured' : 'modeled',
  };
}

/** Map a value to 0–100 where the best candidate scores 100. Lower is better. */
function scoreLowerBetter(value: number, all: readonly number[]): number {
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  if (hi === lo) return 100;
  return ((hi - value) / (hi - lo)) * 100;
}

export function weightsFor(preference: PreferenceId): ScoreWeights {
  return (PREFERENCES.find((p) => p.id === preference) ?? PREFERENCES[0]!).weights;
}

/**
 * Score and rank a set of routes.
 *
 * Scores are RELATIVE to the candidates being compared, so 100 means "the best
 * of these" rather than "good in absolute terms". That is the honest reading:
 * on an evening when every route is bad, the winner is still the best of a bad
 * set, and the congestion figures beside it say so.
 */
export function rankRoutes(routes: readonly Route[], preference: PreferenceId): ScoredRoute[] {
  if (!routes.length) return [];
  const w = weightsFor(preference);
  const assessments = routes.map(assess);

  const etas = routes.map((r) => r.minutes);
  const dists = routes.map((r) => r.km);
  const congestions = assessments.map((a) => a.congestion);
  const hops = routes.map((r) => r.legs.length);
  const reliabilities = assessments.map((a) => a.reliability);
  const bestReliability = Math.max(...reliabilities);

  const scored = routes.map((route, i) => {
    const a = assessments[i]!;
    const parts: Record<keyof ScoreWeights, number> = {
      eta: scoreLowerBetter(route.minutes, etas),
      // reliability is already 0–100 absolute; rescale so the best scores 100
      reliability: bestReliability > 0 ? (a.reliability / bestReliability) * 100 : 100,
      traffic: scoreLowerBetter(a.congestion, congestions),
      distance: scoreLowerBetter(route.km, dists),
      simplicity: scoreLowerBetter(route.legs.length, hops),
    };

    const score =
      parts.eta * w.eta +
      parts.reliability * w.reliability +
      parts.traffic * w.traffic +
      parts.distance * w.distance +
      parts.simplicity * w.simplicity;

    return { route, assessment: a, score: Math.round(score * 10) / 10, parts, reasons: [] as string[] };
  });

  // A profile that promises a superlative has to deliver it. "Fastest" sorts on
  // time outright and uses the blended score only to separate equals; without
  // this the other 40 percent of the weighting can outvote the criterion the
  // control is named after, and the label becomes false.
  const strict = (PREFERENCES.find((p) => p.id === preference) ?? PREFERENCES[0]!).strict;
  scored.sort((x, y) => {
    if (strict === 'eta' && Math.abs(x.route.minutes - y.route.minutes) > 1e-9) {
      return x.route.minutes - y.route.minutes;
    }
    if (strict === 'distance' && Math.abs(x.route.km - y.route.km) > 1e-9) {
      return x.route.km - y.route.km;
    }
    return y.score - x.score;
  });

  for (const s of scored) s.reasons = reasonsFor(s, scored);
  return scored;
}

/** Why this route scored as it did, compared with the others. */
function reasonsFor(entry: ScoredRoute, all: readonly ScoredRoute[]): string[] {
  const reasons: string[] = [];
  const others = all.filter((o) => o !== entry);
  if (!others.length) return ['the only route found'];

  const fastest = Math.min(...all.map((o) => o.route.minutes));
  const shortest = Math.min(...all.map((o) => o.route.km));
  const calmest = Math.min(...all.map((o) => o.assessment.congestion));
  const steadiest = Math.max(...all.map((o) => o.assessment.reliability));

  if (entry.route.minutes === fastest) reasons.push('quickest of the routes found');
  if (entry.route.km === shortest) reasons.push('shortest distance');
  if (entry.assessment.congestion === calmest) reasons.push('least congested');
  if (entry.assessment.reliability === steadiest) reasons.push('most predictable timing');
  if (entry.assessment.riskLevel === 'LOW') reasons.push('low risk of delay');
  if (entry.route.legs.length === Math.min(...all.map((o) => o.route.legs.length))) {
    reasons.push('fewest changes of road');
  }

  if (!reasons.length) {
    const gap = entry.route.minutes - fastest;
    reasons.push(`about ${Math.round(gap)} minutes behind the quickest`);
  }
  return reasons;
}

/* =====================================================================
   EXPLANATION — describing a decision that has already been made

   This is deliberately a template, not a model. The recommendation is settled
   before a single word is written, so the prose can only ever restate it. If a
   language model is added later it slots in exactly here, receiving the same
   structured result and constrained to rephrase it — never to choose.
   ===================================================================== */

const LEVEL_WORDS: Record<TrafficLevel, string> = {
  FREE: 'clear',
  LIGHT: 'light traffic',
  MODERATE: 'moderate traffic',
  HEAVY: 'heavy traffic',
  SEVERE: 'severe congestion',
};

function minutes(n: number): string {
  const m = Math.round(n);
  return m < 60 ? `${m} minutes` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/**
 * Why the engine picked this route, in sentences, from the structured result
 * alone. Every clause traces to a number above it; nothing is inferred.
 */
export function explain(
  ranked: readonly ScoredRoute[],
  preferenceLabel: string,
): string {
  const winner = ranked[0];
  if (!winner) return 'No route was found between these two places.';

  const a = winner.assessment;
  const parts: string[] = [];

  parts.push(
    `The ${preferenceLabel.toLowerCase()} option runs `
    + `${winner.route.path.length - 2 > 0 ? `via ${winner.route.path.slice(1, -1).length} intermediate points` : 'directly'}`
    + `, ${winner.route.km.toFixed(1)} km in about ${minutes(a.uncertainty.expectedMinutes)}.`,
  );

  parts.push(
    `Expect between ${minutes(a.uncertainty.bestMinutes)} and ${minutes(a.uncertainty.worstMinutes)} `
    + `depending on the day — ${a.reliabilityLabel.toLowerCase()}, with ${LEVEL_WORDS[a.level]} overall.`,
  );

  if (a.worstLeg && (a.worstLeg.level === 'HEAVY' || a.worstLeg.level === 'SEVERE')) {
    parts.push(`The slowest stretch is ${a.worstLeg.via}, at ${LEVEL_WORDS[a.worstLeg.level]}.`);
  }

  const runnerUp = ranked[1];
  if (runnerUp) {
    const gap = runnerUp.route.minutes - winner.route.minutes;
    if (Math.abs(gap) < 2) {
      parts.push(
        `The next option takes about the same time, but scores lower on `
        + `${runnerUp.assessment.reliability < a.reliability ? 'predictability' : 'congestion'}.`,
      );
    } else {
      parts.push(`The next best option is ${minutes(Math.abs(gap))} slower.`);
    }
  }

  if (a.basis === 'modeled') {
    parts.push('These times are modeled, not measured.');
  } else if (a.basis === 'mixed') {
    parts.push('Some legs use collected journey times; the rest are modeled.');
  }

  return parts.join(' ');
}

/* =====================================================================
   DEPARTURE OPTIMIZER — "I need to be there by eight"
   ===================================================================== */

export interface DepartureOption {
  /** Minutes after midnight, so a departure can fall on a fractional hour. */
  departAt: number;
  travelMinutes: number;
  arriveAt: number;
  reliability: number;
  score: number;
  /** Whether it lands before the deadline with the buffer intact. */
  feasible: boolean;
}

/**
 * Work backwards from an arrival deadline.
 *
 * Every candidate departure is costed with the same engine that scores routes,
 * so the recommended time is the one whose journey scores best among those
 * that actually arrive in time — not simply the latest one that fits.
 */
export function optimizeDeparture(
  deadlineMinutes: number,
  windowMinutes: number,
  intervalMinutes: number,
  bufferMinutes: number,
  evaluate: (departMinutes: number) => { travelMinutes: number; reliability: number; score: number } | null,
): { options: DepartureOption[]; best: DepartureOption | null } {
  const options: DepartureOption[] = [];
  const earliest = deadlineMinutes - windowMinutes;

  for (let depart = earliest; depart <= deadlineMinutes; depart += intervalMinutes) {
    if (depart < 0) continue;
    const result = evaluate(depart);
    if (!result) continue;
    const arriveAt = depart + result.travelMinutes;
    options.push({
      departAt: depart,
      travelMinutes: result.travelMinutes,
      arriveAt,
      reliability: result.reliability,
      score: result.score,
      feasible: arriveAt <= deadlineMinutes - bufferMinutes,
    });
  }

  const feasible = options.filter((o) => o.feasible);
  // Among the options that get you there, prefer the one that scores best;
  // break ties by leaving later, since nobody wants to wait around.
  const best = feasible.length
    ? feasible.reduce((a, b) => (b.score > a.score || (b.score === a.score && b.departAt > a.departAt) ? b : a))
    : null;

  return { options, best };
}
