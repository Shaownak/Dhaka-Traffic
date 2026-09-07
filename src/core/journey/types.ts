/* =====================================================================
   JOURNEY TYPES — the contract between the planner and everything else

   Both the page and the HTTP API speak exactly this. Keeping the shape in one
   place is what stops the two drifting into subtly different answers to the
   same question.
   ===================================================================== */
import type { PreferenceId } from '../../data/intelligence';
import type { LatLon } from '../geo';
import type { PlaceKind } from '../places/provider';
import type { OpenState } from '../places/opening-hours';
import type { Confidence } from '../traffic/confidence';
import type { TrafficTier } from '../traffic/hierarchy';
import type { Assessment } from '../optimization/scoring';
import type { DayType, Route } from '../routing/graph';
import type { StopCandidate, StopFailure } from '../optimization/stops';

/** What the reader wants from a stop along the way. */
export interface StopConstraint {
  kinds: readonly PlaceKind[];
  /** 0.5 means halfway. */
  position: number;
  dwellMinutes: number;
  cuisine?: string;
  requireOpen?: boolean;
}

/**
 * A journey request.
 *
 * Exactly one of `departAt` and `arriveBy` drives the plan. Giving both is
 * allowed — the deadline wins and the departure becomes the earliest time
 * considered — because that is what somebody means by "I can leave after five
 * but I must be there by seven".
 */
export interface JourneyRequest {
  /** A place id, or free text to be geocoded. */
  origin: string;
  destination: string;
  /** The day being planned. Its weekday decides working or weekend. */
  date: Date;
  /** Minutes after midnight. */
  departAt?: number;
  arriveBy?: number;
  preference?: PreferenceId;
  stop?: StopConstraint | null;
  /** How many alternatives to work up. */
  alternatives?: number;
}

export interface ResolvedPlace {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** What the reader typed, when it differed from the name. */
  query?: string;
  /** How sure the resolution was, 0-1. */
  confidence: number;
  /** Other readings, when the query was vague. */
  alternatives?: { id: string; name: string }[];
}

/** Why an option is in the list. Every label is earned by a calculation. */
export type OptionLabel =
  | 'RECOMMENDED'
  | 'FASTEST'
  | 'MOST_RELIABLE'
  | 'SHORTEST'
  | 'LEAST_TRAFFIC'
  | 'BEST_WITH_STOP';

export interface TimeRange {
  expectedMinutes: number;
  bestMinutes: number;
  worstMinutes: number;
}

/** Minutes after midnight; may exceed 1440 when a journey crosses midnight. */
export interface ArrivalRange {
  expected: number;
  earliest: number;
  latest: number;
}

export interface JourneyStop {
  id: string;
  name: string;
  kind: PlaceKind;
  lat: number;
  lon: number;
  cuisine?: string;
  /** The junction the router reaches it through — the graph has no doorways. */
  viaPlaceId: string;
  viaPlaceName: string;
  /** Straight-line distance from that junction to the door. */
  accessKm: number;
  /** Where it fell along the direct route, 0-1. */
  position: number;
  dwellMinutes: number;
  arriveAt: number;
  departAt: number;
  /** Extra driving against going straight there. */
  detourMinutes: number;
  open: OpenState;
  reasons: string[];
}

export interface JourneyOption {
  id: string;
  labels: OptionLabel[];
  kind: 'direct' | 'with-stop';
  /** Junction ids in order. */
  path: string[];
  /** Human-readable turn list. */
  legs: {
    from: string;
    to: string;
    via: string;
    km: number;
    minutes: number;
    kmh: number;
    tier: TrafficTier;
  }[];
  km: number;
  duration: TimeRange;
  arrival: ArrivalRange;
  /** Driving time only, when a stop splits the journey. */
  travelMinutes: number;
  stop: JourneyStop | null;
  assessment: Assessment;
  confidence: Confidence;
  score: number;
  reasons: string[];
  /** Straight lines between junctions, not true road shape. */
  geometry: LatLon[];
}

export interface DepartureAdvice {
  /** Minutes after midnight. */
  recommended: number;
  earliestSensible: number;
  latestSafe: number;
  arrival: ArrivalRange;
  bufferMinutes: number;
  /** Every candidate considered, for the chart. */
  options: {
    departAt: number;
    travelMinutes: number;
    arriveAt: number;
    feasible: boolean;
  }[];
}

export interface JourneyPlan {
  origin: ResolvedPlace;
  destination: ResolvedPlace;
  date: string;
  dayType: DayType;
  departAt: number;
  /** Present when the request carried a deadline. */
  arriveBy: number | null;
  preference: PreferenceId;
  recommended: JourneyOption;
  alternatives: JourneyOption[];
  departure: DepartureAdvice | null;
  explanation: string;
  confidence: Confidence;
  /**
   * Every place the system fell back or came up empty, in plain words.
   * A plan with missing data is still returned; it just says so.
   */
  notices: string[];
  /** Whose data this is built on. */
  attribution: string[];
  generatedAt: string;
}

export type JourneyErrorCode =
  | 'ORIGIN_NOT_FOUND'
  | 'DESTINATION_NOT_FOUND'
  | 'SAME_PLACE'
  | 'NO_ROUTE'
  | 'DEADLINE_UNREACHABLE';

/**
 * Fields are declared and assigned rather than written as constructor
 * parameter properties: the scripts run this source through Node's type
 * stripper, which does not support that syntax.
 */
export class JourneyError extends Error {
  readonly code: JourneyErrorCode;
  readonly detail: Record<string, unknown> | undefined;

  constructor(code: JourneyErrorCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'JourneyError';
    this.code = code;
    this.detail = detail;
  }
}

export type { StopCandidate, StopFailure, Route };
