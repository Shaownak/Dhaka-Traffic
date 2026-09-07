/* =====================================================================
   TRAFFIC ESTIMATION — a hierarchy of sources, honest about which answered

   Every travel time in this system comes from exactly one of five tiers, and
   the tier travels with the number all the way to the screen. That is the
   whole design. A system that cannot say where a number came from will
   eventually present a guess as a measurement, and the reader has no way to
   tell.

       observed   a recent measurement of this road          (needs a live feed)
       profile    a statistic over collected samples         (needs collection)
       predicted  a fitted model                             (needs both, first)
       baseline   the road's modeled speeds, shaped by hour
       freeflow   the road with no traffic at all            (last resort)

   AS SHIPPED, ONLY baseline AND freeflow CAN ANSWER. There is no live traffic
   feed and no collected series, so nothing else is reachable. The tiers above
   are not aspirational scaffolding: the profile tier activates by itself the
   moment scripts/build/network-times.mjs writes a non-empty file, with no code
   change. The observed and predicted tiers require infrastructure that does
   not exist, and they return null until it does rather than quietly falling
   back to something that looks similar.
   ===================================================================== */
import { HOURLY_SPEED_KMH } from '../../data/traffic';
import { WEEKEND_RELIEF, type Road } from '../../data/network';
import measured from '../../data/measured/network-times.json';

export type DayType = 'working' | 'weekend';

export type TrafficTier = 'observed' | 'profile' | 'predicted' | 'baseline' | 'freeflow';

/** Highest first. The resolver walks this order and takes the first answer. */
export const TIER_ORDER: readonly TrafficTier[] = [
  'observed', 'profile', 'predicted', 'baseline', 'freeflow',
];

export const TIER_LABEL: Record<TrafficTier, string> = {
  observed: 'Recently observed',
  profile: 'Historical profile',
  predicted: 'Model prediction',
  baseline: 'Modeled baseline',
  freeflow: 'Free-flow estimate',
};

/**
 * How much credence a tier earns before sample count and age are considered.
 * A profile built from real samples is worth far more than a baseline built
 * from plausible assumptions, and the gap should be visible in the confidence
 * the reader is shown.
 */
export const TIER_CREDENCE: Record<TrafficTier, number> = {
  observed: 1.00,
  profile: 0.85,
  predicted: 0.70,
  baseline: 0.35,
  freeflow: 0.15,
};

export interface TrafficEstimate {
  minutes: number;
  kmh: number;
  tier: TrafficTier;
  /** Observations behind this number. Zero for modeled tiers — not "unknown". */
  samples: number;
  /** Spread from collected data, when the tier carries one. */
  p10Minutes: number | null;
  p90Minutes: number | null;
  /** Hours since the newest observation, when the tier has one. */
  ageHours: number | null;
}

/* ---------- the collected dataset ---------- */

interface CellStats {
  n: number;
  p10: number;
  p50: number;
  p90: number;
}

interface MeasuredRoad {
  km: number | null;
  freeMinutes: number | null;
  working: (number | null)[];
  weekend: (number | null)[];
  /** Written by newer builder runs; absent in older files. */
  stats?: { working: (CellStats | null)[]; weekend: (CellStats | null)[] };
  lastObservedAt?: string | null;
}

interface MeasuredFile {
  roads?: Record<string, MeasuredRoad>;
  generatedAt?: string | null;
}

const dataset = measured as MeasuredFile;
const profileRoads = dataset.roads ?? {};
const generatedAt = dataset.generatedAt ? Date.parse(dataset.generatedAt) : NaN;

/** True once any road carries collected times. */
export function hasProfileData(): boolean {
  return Object.keys(profileRoads).length > 0;
}

function entryFor(road: Road): MeasuredRoad | null {
  return profileRoads[`${road.a}|${road.b}`] ?? profileRoads[`${road.b}|${road.a}`] ?? null;
}

const hourIndex = (hour: number): number => ((Math.floor(hour) % 24) + 24) % 24;

/* ---------- tier 1: observed ----------
   A live feed would answer here. There is none, so this returns null rather
   than dressing up a lower tier as a measurement. */
function observed(): TrafficEstimate | null {
  return null;
}

/* ---------- tier 2: historical profile ---------- */
function profile(road: Road, hour: number, dayType: DayType): TrafficEstimate | null {
  const entry = entryFor(road);
  if (!entry) return null;

  const h = hourIndex(hour);
  const series = dayType === 'weekend' ? entry.weekend : entry.working;
  const minutes = series?.[h];
  // A road half-collected does not get to guess at the hours it is missing.
  if (typeof minutes !== 'number' || minutes <= 0) return null;

  const cell = (dayType === 'weekend' ? entry.stats?.weekend : entry.stats?.working)?.[h] ?? null;
  const observedAt = entry.lastObservedAt ? Date.parse(entry.lastObservedAt) : generatedAt;

  return {
    minutes,
    kmh: (road.km / minutes) * 60,
    tier: 'profile',
    samples: cell?.n ?? 0,
    p10Minutes: cell?.p10 ?? null,
    p90Minutes: cell?.p90 ?? null,
    ageHours: Number.isFinite(observedAt) ? (Date.now() - observedAt) / 3_600_000 : null,
  };
}

/* ---------- tier 3: prediction ----------
   A fitted model would answer here. Training needs the collected series that
   tier 2 is still waiting for, so this stays null until there is something to
   fit. Shipping an untrained model that returns the baseline in disguise would
   be worse than returning nothing. */
function predicted(): TrafficEstimate | null {
  return null;
}

/* ---------- tier 4: modeled baseline ---------- */

/**
 * How fast a road runs at a given hour, with no observations involved.
 *
 * The city-wide hourly curve sets the shape and the road's own peak and
 * free-flow speeds set the range — the same rule the street simulation uses, so
 * the two cannot tell different stories. On a weekend the congestion is scaled
 * back by the relief factor for that hour rather than removed, because the
 * roads do not empty, they only stop being commuted on.
 */
export function roadSpeed(road: Road, hour: number, dayType: DayType): number {
  const h = hourIndex(hour);
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

function baseline(road: Road, hour: number, dayType: DayType): TrafficEstimate | null {
  const kmh = roadSpeed(road, hour, dayType);
  if (!(kmh > 0)) return null;
  return {
    minutes: (road.km / kmh) * 60,
    kmh,
    tier: 'baseline',
    samples: 0,
    p10Minutes: null,
    p90Minutes: null,
    ageHours: null,
  };
}

/* ---------- tier 5: free flow ---------- */
function freeflow(road: Road): TrafficEstimate {
  const kmh = road.freeKmh > 0 ? road.freeKmh : 20;
  return {
    minutes: (road.km / kmh) * 60,
    kmh,
    tier: 'freeflow',
    samples: 0,
    p10Minutes: null,
    p90Minutes: null,
    ageHours: null,
  };
}

/**
 * Walk the hierarchy and take the first tier that can answer.
 *
 * Deterministic: the same road, hour and day type always resolve through the
 * same tier to the same number.
 */
export function estimateLeg(road: Road, hour: number, dayType: DayType): TrafficEstimate {
  return (
    observed() ??
    profile(road, hour, dayType) ??
    predicted() ??
    baseline(road, hour, dayType) ??
    freeflow(road)
  );
}

/** Which tiers are actually reachable in this deployment, best first. */
export function availableTiers(): TrafficTier[] {
  const tiers: TrafficTier[] = [];
  if (hasProfileData()) tiers.push('profile');
  tiers.push('baseline', 'freeflow');
  return tiers;
}
